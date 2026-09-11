import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import session from 'express-session';
import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import passport from './config/passport.js';
import User from './models/User.js'; // ✅ Add this line
import Group from './models/Group.js'; // ✅ Group model
import GroupMessage from './models/GroupMessage.js'; // ✅ Group message model
import Status from './models/Status.js'; // ✅ Status model
import path from 'path'; // ✅ Add this
import { fileURLToPath } from 'url';
import Message from "./models/Message.js"; // add this on top
import groupRoutes from './routes/groupRoutes.js'; // ✅ Group routes
import statusRoutes, { getStatusViewerIds } from './routes/statusRoutes.js'; // ✅ Status routes
import callRoutes from './routes/callRoutes.js'; // ✅ Call routes
import Call from './models/Call.js'; // ✅ Call model
import { promisify } from 'util';
const verifyAsync = promisify(jwt.verify);

// ✅ Add this to get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config();

const app = express();
const server = http.createServer(app);

// CORS allowed origins. Defaults to local dev; add more via CORS_ORIGINS
// (comma-separated) for the deployed client, e.g.
// CORS_ORIGINS=https://nexchat-one-dun.vercel.app
const corsOrigins = [
  'http://localhost:5173',
  'http://192.168.1.190:5173',
  'https://nexchat-one-dun.vercel.app',
  ...(process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
];

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  // Photos/videos are sent as base64 over the socket; the 1MB default
  // silently drops them. Raise the cap well above what clients send
  // (real guard against Mongo's 16MB doc limit lives per-message below).
  maxHttpBufferSize: 50 * 1024 * 1024
});

// Middleware
app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));

// Session (required for OAuth)
app.use(
  session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/api', authRoutes);
app.use('/api', groupRoutes);
app.use('/api', statusRoutes);
app.use('/api', callRoutes);

// Google Auth Routes
app.get('/api/auth/google',
  (req, res, next) => {
    // Remember which frontend started this login so we can redirect back to it
    const ref = req.headers.referer || '';
    const m = /^(https?:\/\/[^/]+)/.exec(ref);
    if (m) req.session.frontendOrigin = m[1];
    next();
  },
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/api/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/signin' }),
  (req, res) => {
    // Success — generate JWT
    const token = jwt.sign(
      { userId: req.user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // ✅ Redirect back to the frontend the user came from
    const frontendOrigin = req.session.frontendOrigin
      || process.env.FRONTEND_URL
      || 'https://nexchat-one-dun.vercel.app';
    res.redirect(`${frontendOrigin}/dashboard?token=${token}`);
  }
);

// Test route
app.get('/', (req, res) => {
  res.send('<h1>NexChat Backend is Running ✅</h1>');
});

// Socket.IO Authentication & Connection
// Socket.IO Authentication & Connection
const userSocketMap = new Map(); // userId → Set<socketId>

// Get ALL live socket ids for a user (or null if none)
function getSocketIds(userId) {
  const sockets = userSocketMap.get(String(userId));
  if (!sockets || sockets.size === 0) return null;
  return [...sockets];
}

// Emit an event to every socket of a user (handles stale sockets / multiple tabs)
function emitToUser(userId, event, payload, excludeSocketIds = []) {
  const ids = getSocketIds(userId);
  if (!ids) return false;
  ids.forEach((sid) => {
    if (!excludeSocketIds.includes(sid)) {
      io.to(sid).emit(event, payload);
    }
  });
  return true;
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }

  try {
    const decoded = await verifyAsync(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;

    const user = await User.findById(decoded.userId).select("lastSeen");
    socket.lastSeen = user?.lastSeen || new Date();

    next(); // ✅ Now we know user is authenticated
  } catch (err) {
    console.error('Socket auth error:', err.message);
    next(new Error('Authentication error: Invalid token'));
  }
});



// Shared in-memory group call registry: callId -> { type, groupId, callerId, callerName, members:Set<userId> }
// Lives at module scope so every user's socket sees the same active calls.
const groupCalls = new Map();

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.userId);

  // ✅ Flag to prevent duplicate handling
  let isDisconnected = false;

  // ✅ Handle disconnect only once
  socket.on('disconnect', async () => {
    if (isDisconnected) return;
    isDisconnected = true;

    try {
      await User.findByIdAndUpdate(socket.userId, { lastSeen: Date.now() });

      // Remove this socket from the user's set
      const sockets = userSocketMap.get(socket.userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSocketMap.delete(socket.userId);
        }
      }

      // Only notify others OFF if no sockets remain for this user
      if (!sockets || sockets.size === 0) {
        io.emit('userStatus', {
          userId: socket.userId,
          isOnline: false,
          lastSeen: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('Disconnect error:', err.message);
    }
  });

  // (Async connection bookkeeping lives at the END of this callback so every
  //  socket.on(...) handler below is registered BEFORE any await. If an event
  //  arrives while an awaited DB call is still in flight, socket.io has no
  //  handler for it yet and silently DROPS it -> messages appear "not
  //  reaching" the receiver. Early emits must never be lost.)

  // Base64 inflates binary by ~33%. A 12MB base64 string keeps the stored
  // message document safely under Mongo's 16MB BSON limit while still
  // allowing most captured photos and short videos through.
  const MAX_FILE_BASE64 = 12 * 1024 * 1024;

socket.on("sendMessage", async (data) => {
    console.log("📨 [DEBUG] Full data received:", JSON.stringify(data, null, 2)); // 🔥 Full payload
  const { to, message, from, file, fileName, fileType, replyTo, messageId, duration } = data; // 👈 Make sure you receive `messageId`
    console.log("📄 [DEBUG] Extracted fields:", { to, message, from, messageId }); // 🔥 Check values
  const receiverSocketIds = getSocketIds(to);
  if (!from || !to) {
    console.error("❌ Invalid from/to:", { from, to });
    return;
  }
  if (typeof file === 'string' && file.length > MAX_FILE_BASE64) {
    socket.emit('messageSendError', { to, reason: 'file_too_large', message: 'This file is too large to send (max ~9 MB).' });
    return;
  }
  if (typeof message === 'string' && (message.includes('<div') || message.startsWith('{/*'))) {
    console.error("🚫 BLOCKED: Attempt to save JSX as message:", message);
    return;
  }

  try {
    const sender = await User.findById(from).select("name").exec();
    if (!sender) return console.error("Sender not found");
console.log("💾 [DB] Attempting to save message..."); // 🔥
    const newMsg = await Message.create({
      from,
      to,
      message,
      file,
      fileName,
      fileType,
      duration,
      replyTo: replyTo ? {
        sender: replyTo.sender,
        text: replyTo.text,
        messageId: replyTo.messageId,
        statusId: replyTo.statusId,
        senderId: replyTo.senderId
      } : null,
      delivered: !!receiverSocketIds,
      clientMessageId: data.messageId 
    });
     console.log("✅ [SUCCESS] Saved to DB:", {
      _id: newMsg._id,
      message: newMsg.message,
      delivered: newMsg.delivered,
      clientMessageId: newMsg.clientMessageId
    });
    

    if (receiverSocketIds) {
      // ✅ Build one authoritative payload. `to` is included so ANY device of the
      //    sender can place a self-echo in the correct conversation, and every
      //    device renders the same server _id / state.
      const payload = {
        _id: newMsg._id,
        to,
        from,
        fromName: sender.name,
        message,
        file,
        fileName,
        fileType,
        duration,
        replyTo: replyTo,
        timestamp: newMsg.createdAt.getTime(),
        messageId // 👈 Send back to client
      };

      // ✅ Recipient: deliver to ALL of their connected sockets
      receiverSocketIds.forEach((sid) => {
        io.to(sid).emit("receiveMessage", payload);
      });

      // ✅ Sender's other devices: echo the message (excluding the socket that
      //    sent it — that device already shows the message optimistically).
      emitToUser(from, "receiveMessage", payload, [socket.id]);

      // ✅ BONUS: Notify the sender on EVERY device that their message was
      //    delivered (so all synchronized devices advance to the same tick).
      emitToUser(from, "messageDelivered", {
        chatId: to,
        messageId: messageId || newMsg._id.toString(),
        _id: newMsg._id.toString()
      });
    } else {
      console.log(`📥 Stored undelivered message for ${to}`);
    }
  } catch (err) {
    console.error("❌ [CRITICAL] Error in sendMessage:", err); // Full error
  }
});

  // ✅ Load 1:1 message history when a chat is opened / prefetched.
  //    Returns BOTH directions (sent + received) so every device of a user
  //    can rebuild the same conversation state, regardless of which device
  //    actually sent or received each message.
  socket.on("fetchMessages", async (data) => {
    const { chatId } = data || {};
    if (!chatId) return;
    try {
      const me = socket.userId;
      const messages = await Message.find({
        $or: [
          { from: me, to: chatId },
          { from: chatId, to: me },
        ]
      })
        .populate("from", "name")
        .sort({ createdAt: 1 })
        .limit(200)
        .exec();

      const msgs = messages.map(m => ({
        _id: m._id.toString(),
        from: String(m.from._id),
        fromName: m.from.name || 'Unknown',
        message: m.message,
        file: m.file,
        fileName: m.fileName,
        fileType: m.fileType,
        duration: m.duration,
        replyTo: m.replyTo ? {
          sender: m.replyTo.sender,
          text: m.replyTo.text,
          messageId: m.replyTo.messageId,
          statusId: m.replyTo.statusId,
          senderId: m.replyTo.senderId,
        } : null,
        timestamp: new Date(m.createdAt).getTime(),
        read: !!m.read,
        delivered: !!m.delivered,
        messageId: m.clientMessageId,
      }));

      // Emit to every one of this user's sockets so all synced devices get the
      // same authoritative history.
      emitToUser(me, "messagesHistory", { chatId: String(chatId), messages: msgs });
    } catch (err) {
      console.error("fetchMessages error:", err.message);
    }
  });

  // ✅ Handle read receipt
  socket.on("markAsRead", async ({ chatId, readerId }) => {
    await Message.updateMany(
      { from: chatId, to: readerId, read: false },
      { $set: { read: true } }
    );

    const receiver = await User.findById(readerId).select("name").exec();
    if (!receiver) return;

    const senderSocketIds = getSocketIds(chatId);
    if (senderSocketIds) {
      senderSocketIds.forEach((sid) => {
        io.to(sid).emit("messageRead", {
          chatId: readerId,
          readerId,
          readerName: receiver.name,
          timestamp: Date.now(),
        });
      });
    }

    // ✅ Cross-device read-state sync: tell the READER's own other devices that
    //    this conversation is now read so their unread badge clears everywhere.
    emitToUser(readerId, "conversationRead", { chatId: String(chatId) });
  });

  // ✅ Group read receipt: a member has seen the group's messages. For every
  //    unread-by-them message, record them in readBy; once ALL other members
  //    have read a message, tell its sender so their tick turns green.
  socket.on("markGroupRead", async ({ groupId, readerId }) => {
    if (!groupId || !readerId) return;
    try {
      const group = await Group.findById(groupId).exec();
      if (!group || !group.members.map(String).includes(String(readerId))) return;

      const otherMemberIds = (group.members || []).map(String).filter(id => id !== String(readerId));
      if (otherMemberIds.length === 0) return;

      const unread = await GroupMessage.find({
        group: groupId,
        from: { $ne: readerId },
        readBy: { $nin: [String(readerId)] },
      }).exec();

      for (const msg of unread) {
        if (!msg.readBy.map(String).includes(String(readerId))) {
          msg.readBy.push(readerId);
        }
        // WhatsApp-style: green only when every OTHER member (all members except
        // the SENDER) has read the message.
        const senderId = String(msg.from);
        const otherMemberIds = (group.members || []).map(String).filter(id => id !== senderId);
        const readByIds = msg.readBy.map(String);
        const allOthersRead = otherMemberIds.length > 0 && otherMemberIds.every(id => readByIds.includes(id));
        await msg.save();
        if (allOthersRead) {
          if (senderId !== String(readerId)) {
            emitToUser(senderId, "groupMessageReadAll", {
              groupId,
              messageId: msg._id.toString(),
            });
          }
        }
      }

      // ✅ Cross-device read-state sync for groups: clear the reader's own
      //    unread badge on every one of their devices.
      emitToUser(readerId, "groupRead", { groupId: String(groupId) });
    } catch (err) {
      console.error("markGroupRead error:", err.message);
    }
  });

  // ✅ Handle new group creation — notify ALL members so they see the group
  socket.on("createGroup", async (data) => {
    const { name, dp, members } = data;
    if (!name || !name.trim()) return;
    try {
      const admin = socket.userId;
      const memberSet = new Set((members || []).map(String));
      memberSet.add(String(admin));
      const finalMembers = [...memberSet].map(m => m);

      const group = await Group.create({
        name: name.trim(),
        dp: dp || null,
        admin,
        members: finalMembers
      });

      const populated = await Group.findById(group._id)
        .populate('admin', 'name photo')
        .populate('members', 'name photo');

      const payload = { group: populated };

      // Create the group for the creator (echo back)
      socket.emit("groupCreated", payload);

      // Notify every other member that they've been added to a group
      finalMembers.forEach((memberId) => {
        if (memberId === String(admin)) return;
        emitToUser(memberId, "groupAdded", payload);
      });
    } catch (err) {
      console.error("createGroup socket error:", err.message);
    }
  });

  // ✅ Handle group message
  socket.on("sendGroupMessage", async (data) => {
    const { groupId, message, file, fileName, fileType, messageId, duration } = data;
    if (!groupId) return;
    if (typeof file === 'string' && file.length > MAX_FILE_BASE64) {
      socket.emit('messageSendError', { groupId, reason: 'file_too_large', message: 'This file is too large to send (max ~9 MB).' });
      return;
    }
    try {
      const sender = await User.findById(socket.userId).select("name photo").exec();
      if (!sender) return;

      const group = await Group.findById(groupId).exec();
      if (!group) return;
      // Only members can send
      if (!group.members.map(String).includes(String(socket.userId))) return;

      const newMsg = await GroupMessage.create({
        group: groupId,
        from: socket.userId,
        message,
        file,
        fileName,
        fileType,
        duration,
        clientMessageId: data.messageId
      });

      const payload = {
        _id: newMsg._id,
        groupId,
        from: socket.userId,
        fromName: sender.name,
        fromPhoto: sender.photo,
        message,
        file,
        fileName,
        fileType,
        duration,
        timestamp: newMsg.createdAt.getTime(),
        messageId
      };

      // Send to every member's sockets (except sender's own — sender already shows optimistically)
      group.members.forEach((memberId) => {
        const sid = String(memberId) === String(socket.userId) ? socket.id : null;
        emitToUser(memberId, "receiveGroupMessage", payload, [socket.id]);
      });

      // Per-member delivery receipt: a member has "received" the message when
      // their device was online to take the emit above (or when they later load
      // history — see fetchGroupMessages). Record every online member now so the
      // double tick waits for ALL members, not just the server saving the message.
      const senderIdStr = String(socket.userId);
      const otherMemberIds = (group.members || []).map(String).filter(id => id !== senderIdStr);
      const updated = await GroupMessage.findByIdAndUpdate(
        newMsg._id,
        {
          $addToSet: {
            deliveredBy: {
              $each: group.members
                .map(String)
                .filter(id => id !== senderIdStr && getSocketIds(id))
            }
          }
        },
        { new: true }
      ).exec();
      const deliveredByIds = (updated?.deliveredBy || []).map(String);
      const allDelivered = otherMemberIds.length > 0
        ? otherMemberIds.every(id => deliveredByIds.includes(id))
        : true;

      // Confirm id adoption to the sender on ALL of their devices (so the ticking
      // message also adopts the saved _id everywhere and never duplicates).
      emitToUser(socket.userId, "groupMessageDelivered", {
        groupId,
        messageId: messageId || newMsg._id.toString(),
        _id: newMsg._id.toString(),
        allDelivered,
      });
    } catch (err) {
      console.error("sendGroupMessage error:", err.message);
    }
  });

  // ✅ Group delivery receipt: a member's device confirms it received a live
  //    `receiveGroupMessage`. Record them in deliveredBy; once every OTHER
  //    member has received the message, tell its sender so their tick goes ✓✓.
  socket.on("groupMessageReceived", async ({ groupId, messageId }) => {
    if (!groupId || !messageId) return;
    try {
      const group = await Group.findById(groupId).exec();
      if (!group || !group.members.map(String).includes(String(socket.userId))) return;

      const msg = await GroupMessage.findOne({ _id: messageId, group: groupId }).exec();
      if (!msg) return;

      const senderIdStr = String(msg.from);
      if (senderIdStr === String(socket.userId)) return; // sender can't be "delivered to" by itself

      let changed = false;
      const readByIds = msg.deliveredBy.map(String);
      if (!readByIds.includes(String(socket.userId))) {
        msg.deliveredBy.push(socket.userId);
        changed = true;
      }
      await msg.save();

      const otherMemberIds = (group.members || []).map(String).filter(id => id !== senderIdStr);
      const deliveredByIds = msg.deliveredBy.map(String);
      const allDelivered = otherMemberIds.length > 0
        ? otherMemberIds.every(id => deliveredByIds.includes(id))
        : true;
      if (changed && allDelivered) {
        emitToUser(senderIdStr, "groupMessageDelivered", {
          groupId,
          messageId: msg._id.toString(),
          _id: msg._id.toString(),
          allDelivered: true,
        });
      }
    } catch (err) {
      console.error("groupMessageReceived error:", err.message);
    }
  });

  // ✅ Load group message history when a member opens a group
  socket.on("fetchGroupMessages", async (data) => {
    const { groupId } = data;
    if (!groupId) return;
    try {
      const group = await Group.findById(groupId).exec();
      if (!group) return;
      if (!group.members.map(String).includes(String(socket.userId))) return;

      const history = await GroupMessage.find({ group: groupId })
        .populate('from', 'name photo')
        .sort({ createdAt: 1 })
        .limit(200)
        .exec();

      // Opening the group means this member's device just received every message
      // in it (even ones from before the emitting socket connected). Record the
      // fetch in deliveredBy so their being offline never blocks the sender's
      // double-tick forever, then notify any sender the message newly completed.
      const selfIdStr = String(socket.userId);
      const groupMemberIds = (group.members || []).map(String);
      const memberChanged = new Map();

      for (const m of history) {
        const senderIdStr = String(m.from._id);
        if (senderIdStr === selfIdStr) continue;
        const deliveredIds = (m.deliveredBy || []).map(String);
        if (!deliveredIds.includes(selfIdStr)) {
          m.deliveredBy.push(selfIdStr);
          await m.save();
          memberChanged.set(m._id.toString(), m);
        }
      }

      for (const [msgId, m] of memberChanged) {
        const senderIdStr = String(m.from._id);
        const otherMemberIds = groupMemberIds.filter(id => id !== senderIdStr);
        const deliveredByIds = (m.deliveredBy || []).map(String);
        const allDelivered = otherMemberIds.length > 0
          ? otherMemberIds.every(id => deliveredByIds.includes(id))
          : true;
        if (allDelivered) {
          emitToUser(senderIdStr, "groupMessageDelivered", {
            groupId,
            messageId: msgId,
            _id: msgId,
            allDelivered: true,
          });
        }
      }

      const msgs = history.map(m => {
        const otherMemberIds = groupMemberIds.filter(id => id !== String(m.from._id));
        const readByIds = (m.readBy || []).map(String);
        const deliveredByIds = (m.deliveredBy || []).map(String);
        return {
          _id: m._id,
          groupId,
          from: String(m.from._id),
          fromName: m.from.name || 'Unknown',
          fromPhoto: m.from.photo,
          message: m.message,
          file: m.file,
          fileName: m.fileName,
          fileType: m.fileType,
          duration: m.duration,
          timestamp: new Date(m.createdAt).getTime(),
          // WhatsApp-style group read tick: green only once every OTHER member
          // has seen the message. `allRead` is computed server-side so every
          // device of the sender agrees on the same tick state.
          readBy: readByIds,
          allRead: otherMemberIds.length > 0 && otherMemberIds.every(id => readByIds.includes(id)),
          // WhatsApp-style group delivery tick: ✓✓ only once every OTHER member's
          // device has received the message. Same server-side aggregation as allRead.
          deliveredBy: deliveredByIds,
          allDelivered: otherMemberIds.length > 0 && otherMemberIds.every(id => deliveredByIds.includes(id)),
        };
      });

      io.to(socket.id).emit("groupMessagesHistory", { groupId, messages: msgs });
    } catch (err) {
      console.error("fetchGroupMessages error:", err.message);
    }
  });

  // ✅ Delete a 1:1 message
  // data: { to, messageId, _id, forEveryone }
  //   forEveryone=true  -> sender deletes from DB + both sides remove it
  //   forEveryone=false -> sender removes locally only (client handles local removal)
  socket.on("deleteMessage", async (data) => {
    const { to, messageId, _id, forEveryone } = data || {};
    try {
      console.log("[DELETE] received:", JSON.stringify({ to, messageId, _id, forEveryone, self: socket.userId }), "forEveryone=", forEveryone);
      // Only the actual sender may delete-for-everyone
      if (forEveryone) {
        // messageId may be the Mongo _id (string) OR the client temp id; match either
        const conditions = [];
        const isOid = (v) => /^[0-9a-fA-F]{24}$/.test(String(v || ''));
        if (isOid(_id)) conditions.push({ _id });
        if (isOid(messageId)) conditions.push({ _id: messageId });
        if (messageId) conditions.push({ clientMessageId: messageId });
        if (conditions.length === 0) { console.log("[DELETE] no conditions"); return; }
        const deleted = await Message.findOneAndDelete({ from: socket.userId, $or: conditions }).exec();
        console.log("[DELETE] findOneAndDelete result:", deleted ? "FOUND+DELETED " + deleted._id : "NOT FOUND", "conditions=", JSON.stringify(conditions));
        if (deleted) {
          const payload = { _id: deleted._id, messageId: deleted.clientMessageId || messageId };
          // Notify the chat partner's sockets so they remove it too
          if (to) { console.log("[DELETE] emitting messageDeleted to partner", to); emitToUser(to, "messageDeleted", payload); }
          // Notify sender's own other sockets too
          emitToUser(socket.userId, "messageDeleted", payload, [socket.id]);
        }
      } else {
        // delete for me: just confirm locally; no DB change for the other side
        socket.emit("messageDeletedFor", { messageId, _id, forMe: true });
      }
    } catch (err) {
      console.error("deleteMessage error:", err.message);
    }
  });

  // ✅ Clear a 1:1 chat
  // data: { to, forEveryone }
  socket.on("clearChat", async (data) => {
    const { to, forEveryone } = data || {};
    try {
      if (forEveryone && to) {
        const uid = socket.userId;
        await Message.deleteMany({
          $or: [
            { from: uid, to },
            { from: to, to: uid }
          ]
        }).exec();
        emitToUser(to, "chatCleared", { by: uid });
      }
      socket.emit("chatCleared", { to, forMe: true });
    } catch (err) {
      console.error("clearChat error:", err.message);
    }
  });

  // ✅ Delete a group message
  // data: { groupId, messageId, _id, forEveryone }
  socket.on("deleteGroupMessage", async (data) => {
    const { groupId, messageId, _id, forEveryone } = data || {};
    if (!groupId) return;
    try {
      const group = await Group.findById(groupId).exec();
      if (!group || !group.members.map(String).includes(String(socket.userId))) return;

      if (forEveryone) {
        const conditions = [];
        const isOid = (v) => /^[0-9a-fA-F]{24}$/.test(String(v || ''));
        if (isOid(_id)) conditions.push({ _id });
        if (isOid(messageId)) conditions.push({ _id: messageId });
        if (messageId) conditions.push({ clientMessageId: messageId });
        if (conditions.length === 0) return;
        conditions.forEach((c) => (c.group = groupId));
        conditions.forEach((c) => (c.from = socket.userId));
        const deleted = await GroupMessage.findOneAndDelete({ $or: conditions }).exec();
        if (deleted) {
          const payload = { groupId, _id: deleted._id, messageId: deleted.clientMessageId || messageId };
          group.members.forEach((memberId) => {
            emitToUser(memberId, "groupMessageDeleted", payload, [socket.id]);
          });
        }
      } else {
        socket.emit("groupMessageDeletedFor", { groupId, messageId, _id, forMe: true });
      }
    } catch (err) {
      console.error("deleteGroupMessage error:", err.message);
    }
  });

  // ✅ Clear a group chat
  // data: { groupId, forEveryone }
  socket.on("clearGroupChat", async (data) => {
    const { groupId, forEveryone } = data || {};
    if (!groupId) return;
    try {
      const group = await Group.findById(groupId).exec();
      if (!group || !group.members.map(String).includes(String(socket.userId))) return;
      if (forEveryone) {
        await GroupMessage.deleteMany({ group: groupId }).exec();
        group.members.forEach((memberId) => {
          emitToUser(memberId, "groupChatCleared", { groupId }, [socket.id]);
        });
      } else {
        socket.emit("groupChatCleared", { groupId, forMe: true });
      }
    } catch (err) {
      console.error("clearGroupChat error:", err.message);
    }
  });

  // ✅ Post a WhatsApp-style status. Only the poster's contacts (people they
  //    chat with) receive the realtime `statusPosted` event; the feed itself
  //    also enforces the same visibility rule.
  socket.on("postStatus", async (data) => {
    const { type, text, bg, file } = data || {};
    try {
      const isMedia = type === 'image' || type === 'video';
      const status = await Status.create({
        user: socket.userId,
        type: isMedia ? type : 'text',
        text: String(text || '').slice(0, 120),
        bg: bg || 'default',
        file: isMedia ? (file || '') : '',
      });

      const owner = await User.findById(socket.userId).select('name photo').lean().exec();
      const payload = {
        _id: String(status._id),
        user: {
          id: String(socket.userId),
          name: owner?.name || 'Unknown',
          photo: owner?.photo || 'https://via.placeholder.com/50',
        },
        type: status.type,
        text: status.text || '',
        bg: status.bg || 'default',
        file: status.file || '',
        createdAt: status.createdAt.getTime(),
        viewed: false,
      };

      // Notify every viewer (including the poster's own other sockets) so
      // their status list refreshes instantly.
      const viewerIds = await getStatusViewerIds(socket.userId);
      viewerIds.forEach((uid) => emitToUser(uid, 'statusPosted', payload));
    } catch (err) {
      console.error("postStatus error:", err.message);
    }
  });

  // ✅ Delete one of my own statuses
  socket.on("deleteStatus", async ({ statusId }) => {
    if (!statusId) return;
    try {
      const deleted = await Status.findOneAndDelete({
        _id: statusId,
        user: socket.userId,
      }).exec();
      if (!deleted) return;
      const viewerIds = await getStatusViewerIds(socket.userId);
      viewerIds.forEach((uid) =>
        emitToUser(uid, 'statusDeleted', { statusId: String(deleted._id) })
      );
    } catch (err) {
      console.error("deleteStatus error:", err.message);
    }
  });

  // ==================== CALLS (voice/video) ====================

  // Persist a finished call for both participants and notify them to refresh.
  async function logCall(callerId, calleeId, type, status, durationSec, opts) {
    try {
      const call = await Call.create({
        caller: callerId,
        callee: calleeId,
        type: type === 'video' ? 'video' : 'voice',
        status: status === 'missed' ? 'missed' : 'ended',
        durationSec: Math.max(0, Math.round(durationSec || 0)),
        groupId: opts?.groupId || null,
        callerName: opts?.callerName || '',
      });
      emitToUser(callerId, 'call:historyUpdated', { callId: String(call._id) });
      if (String(calleeId) !== String(callerId)) {
        emitToUser(calleeId, 'call:historyUpdated', { callId: String(call._id) });
      }
    } catch (err) {
      console.error('logCall error:', err.message);
    }
  }

  // Caller starts a call -> ring the callee on all their devices.
  socket.on('call:invite', async ({ to, type, callId, name, photo }) => {
    if (!to || !callId) return;
    const peer = await User.findById(to).select('name photo').lean().exec();
    const me = await User.findById(socket.userId).select('name photo').lean().exec();
    emitToUser(to, 'call:incoming', {
      callId,
      type,
      from: String(socket.userId),
      fromName: name || me?.name || 'Unknown',
      fromPhoto: photo || me?.photo || 'https://via.placeholder.com/50',
      callerName: peer ? peer.name : undefined,
    });
    socket.emit('call:ringing', { callId });
  });

  // Group call: ring every member (mesh; each side builds its own peer).
  socket.on('call:inviteGroup', async ({ groupId, type, callId, name, photo, memberIds }) => {
    if (!groupId || !callId || !Array.isArray(memberIds)) return;
    const me = await User.findById(socket.userId).select('name photo').lean().exec();
    groupCalls.set(callId, {
      type,
      groupId: String(groupId),
      callerId: String(socket.userId),
      callerName: name || me?.name || 'Unknown',
      members: new Set([String(socket.userId)]),
    });
    memberIds.forEach((uid) => {
      if (String(uid) === String(socket.userId)) return;
      emitToUser(uid, 'call:groupIncoming', {
        callId,
        type,
        groupId: String(groupId),
        from: String(socket.userId),
        fromName: me?.name || 'Unknown',
        fromPhoto: photo || me?.photo || 'https://via.placeholder.com/50',
        groupName: name,
      });
    });
    socket.emit('call:ringing', { callId });
  });

  // Member answers a group call -> give them the current roster and tell the
  // rest (including the caller) so every pair can wire up WebRTC.
  socket.on('call:acceptGroup', ({ to, callId, type }) => {
    if (!to || !callId) return;
    let ca = groupCalls.get(callId);
    if (!ca) {
      ca = { type, groupId: null, callerId: String(to), callerName: 'Group', members: new Set([String(to), String(socket.userId)]) };
      groupCalls.set(callId, ca);
    } else {
      ca.members.add(String(socket.userId));
    }
    const joined = [...ca.members];
    socket.emit('call:groupJoined', {
      callId,
      type,
      groupId: ca.groupId,
      members: joined.filter((mid) => String(mid) !== String(socket.userId)).map((mid) => ({ id: mid })),
    });
    joined.forEach((mid) => {
      if (String(mid) === String(socket.userId)) return;
      emitToUser(mid, 'call:memberJoined', { callId, type, userId: String(socket.userId), groupId: ca.groupId });
    });
    // The caller (initiator) opens the active call UI too.
    emitToUser(to, 'call:accepted', { callId, type });
    // Also stop the ringing UI on the accepting member's OTHER devices.
    emitToUser(socket.userId, 'call:endedLocal', { callId }, [socket.id]);
  });

  // Member leaves a group call -> notify everyone else. If nobody but the
  // caller is left there is no call anymore, so end it for that last member.
  socket.on('call:memberLeft', ({ to, callId, type }) => {
    const ca = groupCalls.get(callId);
    if (!ca) return;
    ca.members.delete(String(socket.userId));
    [...ca.members].forEach((mid) => emitToUser(mid, 'call:memberLeft', { callId, userId: String(socket.userId), type }));
    if (ca.members.size <= 1) {
      [...ca.members].forEach((mid) => emitToUser(mid, 'call:ended', { callId }));
      groupCalls.delete(callId);
    }
  });

  // Member ends their group-call session -> log their own record + notify others.
  // In a two-person group call (or when the last other member leaves) the call
  // should end for the remaining member instead of leaving them alone on-screen.
  socket.on('call:groupEnd', ({ groupId, callId, type, durationSec, callerName }) => {
    const secs = Math.max(0, Math.round(durationSec || 0));
    logCall(socket.userId, socket.userId, type, secs > 0 ? 'ended' : 'missed', secs, { groupId, callerName });
    const ca = groupCalls.get(callId);
    if (ca) {
      ca.members.delete(String(socket.userId));
      [...ca.members].forEach((mid) => emitToUser(mid, 'call:memberLeft', { callId, userId: String(socket.userId), type }));
      if (ca.members.size <= 1) {
        [...ca.members].forEach((mid) => emitToUser(mid, 'call:ended', { callId }));
        // The last remaining member had their call ended by someone else's
        // hang-up, so persist their own group-call record too. Otherwise that
        // side's history would be missing the finished call.
        [...ca.members].forEach((mid) => {
          if (String(mid) !== String(socket.userId)) {
            logCall(mid, mid, type, secs > 0 ? 'ended' : 'missed', secs, { groupId, callerName });
          }
        });
        groupCalls.delete(callId);
      }
    }
    socket.emit('call:endedLocal', { callId });
    // Also close the group-call UI on this member's OTHER devices.
    emitToUser(socket.userId, 'call:endedLocal', { callId }, [socket.id]);
  });

  // Caller cancels a group ring (nobody answered) -> one missed group record.
  socket.on('call:groupTimeout', ({ groupId, callId, type, callerName }) => {
    logCall(socket.userId, socket.userId, type, 'missed', 0, { groupId, callerName });
    groupCalls.delete(callId);
    socket.emit('call:endedLocal', { callId });
    // Also close the ringing group-call UI on the caller's OTHER devices.
    emitToUser(socket.userId, 'call:endedLocal', { callId }, [socket.id]);
  });

  // Callee accepts -> caller opens the active call UI.
  socket.on('call:accept', ({ to, callId, type }) => {
    if (!to || !callId) return;
    emitToUser(to, 'call:accepted', { callId, type });
    // Also stop the ringing UI on the accepting user's OTHER devices.
    emitToUser(socket.userId, 'call:endedLocal', { callId }, [socket.id]);
  });

  // Callee declines -> mark missed for the caller.
  socket.on('call:reject', async ({ to, callId, type }) => {
    if (!to) return;
    const peer = await User.exists({ _id: to }).catch(() => null);
    if (peer) logCall(socket.userId, to, type, 'missed', 0);
    socket.emit('call:rejectedRemote', { callId, type });
    emitToUser(to, 'call:rejected', { callId, type });
    // Also close the ringing/active call UI on the rejecting user's OTHER devices.
    emitToUser(socket.userId, 'call:endedLocal', { callId }, [socket.id]);
  });

  // Either side hangs up -> both close; the CALLER records the finished call
  // (caller was ringed to accept, so caller always initiated).
  socket.on('call:end', async ({ to, callId, type, durationSec }) => {
    if (!to) return;
    const secs = Math.max(0, Math.round(durationSec || 0));
    const peer = await User.exists({ _id: to }).catch(() => null);
    if (peer) logCall(socket.userId, to, type, secs > 0 ? 'ended' : 'missed', secs);
    socket.emit('call:endedLocal', { callId });
    emitToUser(to, 'call:ended', { callId });
    // Also close the call UI on the hanging-up user's OTHER devices.
    emitToUser(socket.userId, 'call:endedLocal', { callId }, [socket.id]);
  });

  // Caller timeout (callee never answered) -> mark missed.
  socket.on('call:timeout', async ({ to, callId, type }) => {
    if (!to) return;
    const peer = await User.exists({ _id: to }).catch(() => null);
    if (peer) logCall(socket.userId, to, type, 'missed', 0);
    emitToUser(to, 'call:timedOut', { callId });
    // Also close the ringing "calling..." UI on the caller's OTHER devices.
    emitToUser(socket.userId, 'call:endedLocal', { callId }, [socket.id]);
  });

  // WebRTC signaling relay between the two peers.
  socket.on('rtc:offer', ({ to, callId, sdp }) => {
    if (!to || !callId || !sdp) return;
    emitToUser(to, 'rtc:offer', { from: String(socket.userId), callId, sdp });
  });
  socket.on('rtc:answer', ({ to, callId, sdp }) => {
    if (!to || !callId || !sdp) return;
    emitToUser(to, 'rtc:answer', { from: String(socket.userId), callId, sdp });
  });
  socket.on('rtc:ice', ({ to, callId, candidate }) => {
    if (!to || !callId || !candidate) return;
    emitToUser(to, 'rtc:ice', { from: String(socket.userId), callId, candidate });
  });
  // Keepalive so both sides' heartbeat timers survive socket throttling.
  socket.on('call:ping', ({ to, callId }) => {
    if (!to || !callId) return;
    emitToUser(to, 'call:ping', { from: String(socket.userId), callId });
  });

  // Peer UI state (camera/mic toggles) relay.
  socket.on('call:state', ({ to, callId, cameraOn, micOn }) => {
    if (!to || !callId) return;
    emitToUser(to, 'call:state', { from: String(socket.userId), callId, cameraOn, micOn });
  });

  // ✅ Async connection bookkeeping — runs AFTER every socket.on handler is
  //    registered, so no client emit can race an in-flight await and get
  //    silently dropped before a handler exists to receive it.
  (async () => {
    try {
      // Track this socket id in the user's set of connected sockets (added
      // synchronously, before any DB await, so the receiver map is ready)
      if (!userSocketMap.has(socket.userId)) {
        userSocketMap.set(socket.userId, new Set());
      }
      userSocketMap.get(socket.userId).add(socket.id);

      await User.findByIdAndUpdate(socket.userId, { lastSeen: Date.now() });

      // ✅ Emit this user's online status to everyone (including self)
      io.emit('userStatus', {
        userId: socket.userId,
        isOnline: true,
        lastSeen: null
      });

      // ✅ Snapshot: tell the newly-connected user who is ALREADY online
      const onlineSnapshot = [];
      for (const [userId, sockets] of userSocketMap.entries()) {
        if (userId !== socket.userId && sockets.size > 0) {
          onlineSnapshot.push({ userId, isOnline: true, lastSeen: null });
        }
      }
      io.to(socket.id).emit('userStatusSnapshot', onlineSnapshot);

      // ✅ Deliver undelivered messages
      const undelivered = await Message.find({
        to: socket.userId,
        delivered: false
      }).populate("from", "name");

      if (undelivered.length > 0) {
        console.log(`📦 Delivering ${undelivered.length} undelivered messages to ${socket.userId}`);

        for (const msg of undelivered) {
          // 1. Send message to now-online recipient
          io.to(socket.id).emit("receiveMessage", {
            _id: msg._id,
            from: msg.from._id,
            fromName: msg.from.name,
            message: msg.message,
            file: msg.file,
            fileName: msg.fileName,
            fileType: msg.fileType,
            duration: msg.duration,
            timestamp: msg.createdAt.getTime(),
            messageId: msg.clientMessageId
          });

          // 2. Mark as delivered in DB
          msg.delivered = true;
          await msg.save();

          // 3. ✅ Notify the original sender that their message was DELIVERED
          emitToUser(msg.from._id.toString(), "messageDelivered", {
            chatId: msg.to.toString(),
            messageId: msg.clientMessageId,
            _id: msg._id.toString()
          });

          console.log(`✅ Delivered stored message ${msg._id} from ${msg.from._id} to ${msg.to}`);
        }
      }
    } catch (err) {
      console.error("❌ Connection bookkeeping error:", err);
    }
  })();
});


// Add this route in your backend
app.get('/api/files/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.params.filename);
  const fileName = req.query.download || req.params.filename;

  res.setHeader(
    'Content-Disposition',
    `inline; filename="${fileName}"`
  );
  res.setHeader('Content-Type', 'application/octet-stream');

  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(404).send('File not found');
    }
  });
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.log('❌ DB Error:', err));

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`🎮 Socket.IO enabled for real-time messaging`);
});