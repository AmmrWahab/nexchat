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
import profileRoutes from './routes/profileRoutes.js'; // ✅ Profile / block / report
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
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

app.use(express.json());

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
app.use('/api', profileRoutes);

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

socket.on("sendMessage", async (data) => {
  const { to, message, from, file, fileName, fileType, replyTo, messageId, duration, forwarded } = data;
  if (!from || !to) {
    console.error("❌ Invalid from/to:", { from, to });
    return;
  }
  if (typeof message === 'string' && (message.includes('<div') || message.startsWith('{/*'))) {
    console.error("🚫 BLOCKED: Attempt to save JSX as message:", message);
    return;
  }

  try {
    const sender = await User.findById(from).select("name photo").exec();
    if (!sender) return console.error("Sender not found");

    const senderBlockedIds = (sender.blocked || []).map(String);

    // I blocked this person -> their message is NOT written at all.
    if (senderBlockedIds.includes(String(to))) {
      socket.emit("messageRejected", { to, messageId, reason: "blocked" });
      return;
    }

    // Load the receiver to check whether THEY blocked me.
    const receiver = await User.findById(to).select("name blocked").exec();
    const receiverBlockedIds = receiver ? (receiver.blocked || []).map(String) : [];
    const theyBlockedMe = receiverBlockedIds.includes(String(socket.userId)) || receiverBlockedIds.includes(String(from));

    const newMsg = await Message.create({
      from,
      to,
      message,
      file,
      fileName,
      fileType,
      duration,
      forwarded: !!forwarded,
      replyTo: replyTo ? {
        sender: replyTo.sender,
        text: replyTo.text,
        messageId: replyTo.messageId
      } : null,
      delivered: !theyBlockedMe && !!getSocketIds(to),
      clientMessageId: data.messageId 
    });

    if (theyBlockedMe) {
      // They blocked us. Do NOT deliver; message stays at a single tick for the
      // sender. It is persisted (delivered:false) so their history is intact.
      console.log(`📥 Stored undelivered (blocked) message from ${from} to ${to}`);
      return;
    }

    const receiverSocketIds = getSocketIds(to);
    if (receiverSocketIds) {
      // ✅ Send message to ALL of the recipient's connected sockets
      receiverSocketIds.forEach((sid) => {
        io.to(sid).emit("receiveMessage", {
          _id: newMsg._id,
          from,
          to,
          fromName: sender.name,
          fromPhoto: sender.photo,
          message,
          file,
          fileName,
          fileType,
          duration,
          forwarded: !!forwarded,
          replyTo: replyTo,
          timestamp: newMsg.createdAt.getTime(),
          messageId // 👈 Send back to client
        });
      });

      // ✅ Snapshot of successful call
      const snap = () => ({ chatId: to, messageId: messageId || newMsg._id.toString() });

      // Confirm delivery on EVERY device of the sender, not just the one that
      // sent it — otherwise a second device would never learn its message ticked.
      emitToUser(from, "messageDelivered", snap());
      if (socket && socket.id) {
        io.to(socket.id).emit("messageDelivered", snap());
      }
    } else {
      console.log(`📥 Stored undelivered message for ${to}`);
    }

    // 🔥 Cross-device echo: the sender's OTHER devices (tabs) should also see
    // this message.
    emitToUser(from, "receiveMessage", {
      _id: newMsg._id,
      from,
      to,
      fromName: sender.name,
      fromPhoto: sender.photo,
      message,
      file,
      fileName,
      fileType,
      duration,
      forwarded: !!forwarded,
      replyTo: replyTo,
      timestamp: newMsg.createdAt.getTime(),
      messageId,
      source: 'self'
    }, [socket.id]);
  } catch (err) {
    console.error("❌ [CRITICAL] Error in sendMessage:", err);
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
  });

  // ✅ Load 1:1 message history when the user opens a conversation. Returns
  //    both directions so ANY device (even one that never saw the chat) can
  //    render the full thread. Also marks received messages delivered (and
  //    tells the sender) since the recipient is now definitely online.
  socket.on("fetchMessages", async ({ to }) => {
    if (!to) return;
    try {
      const uid = String(socket.userId);
      const me = await User.findById(uid).select("blocked").exec();
      const blockedSet = new Set((me?.blocked || []).map(String));
      const peerBlocked = blockedSet.has(String(to));

      const messages = await Message.find({
        $or: [
          { from: uid, to },
          { from: to, to: uid },
        ],
      })
        .populate("from", "name photo")
        .sort({ createdAt: 1 })
        .limit(200)
        .exec();

      // WhatsApp semantics: a user I blocked cannot reach me. Hide their
      // messages from MY history view, but keep my own outgoing messages.
      const visible = peerBlocked
        ? messages.filter((m) => String(m.from._id) === uid)
        : messages;

      const msgs = visible.map((m) => ({
        _id: m._id,
        from: String(m.from._id),
        fromName: m.from.name || "Unknown",
        fromPhoto: m.from.photo,
        message: m.message,
        file: m.file,
        fileName: m.fileName,
        fileType: m.fileType,
        duration: m.duration,
        forwarded: !!m.forwarded,
        replyTo: m.replyTo,
        timestamp: new Date(m.createdAt).getTime(),
        delivered: m.delivered,
        read: m.read,
        messageId: m.clientMessageId,
      }));

      io.to(socket.id).emit("messagesHistory", { to, messages: msgs });

      // Messages FROM the peer TO me are now definitely received on this device.
      // (Skip this for blocked peers so they never see a delivered tick.)
      const pending = messages.filter(
        (m) => String(m.from._id) === String(to) && !m.delivered && !peerBlocked
      );
      if (pending.length > 0) {
        const ids = pending.map((m) => m._id);
        await Message.updateMany({ _id: { $in: ids } }, { $set: { delivered: true } });
        pending.forEach((m) =>
          emitToUser(String(to), "messageDelivered", {
            chatId: uid,
            messageId: m.clientMessageId || String(m._id),
          })
        );
      }
    } catch (err) {
      console.error("fetchMessages error:", err.message);
    }
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
    const { groupId, message, file, fileName, fileType, messageId, duration, forwarded } = data;
    if (!groupId) return;
    try {
      const sender = await User.findById(socket.userId).select("name photo").exec();
      if (!sender) return;

      const group = await Group.findById(groupId).exec();
      if (!group) return;
      // Only members can send
      if (!group.members.map(String).includes(String(socket.userId))) {
        socket.emit("groupMessageRejected", { groupId, reason: "not-member" });
        return;
      }

      const newMsg = await GroupMessage.create({
        group: groupId,
        from: socket.userId,
        message,
        file,
        fileName,
        fileType,
        duration,
        forwarded: !!forwarded,
        clientMessageId: data.messageId,
        deliveredBy: [socket.userId],
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
        forwarded: !!forwarded,
        timestamp: newMsg.createdAt.getTime(),
        messageId
      };

      // Send to every member's sockets (except sender's own — sender already shows optimistically)
      group.members.forEach((memberId) => {
        emitToUser(memberId, "receiveGroupMessage", payload, [socket.id]);
      });

      // Confirm delivery to the sender on ALL of their devices (so the ticking
      // message also adopts the saved _id everywhere and never duplicates).
      emitToUser(socket.userId, "groupMessageDelivered", {
        groupId,
        messageId: messageId || newMsg._id.toString(),
        _id: newMsg._id.toString(),
      });
    } catch (err) {
      console.error("sendGroupMessage error:", err.message);
    }
  });

  // ✅ Group delivery ack: a member's device actually received a group message.
  //    Record them in deliveredBy; once every OTHER member has received it, tell
  //    the sender so their tick flips from a single to a double tick.
  socket.on("groupMessageReceived", async ({ groupId, messageId }) => {
    if (!groupId || !messageId) return;
    try {
      const msg = await GroupMessage.findOne({
        _id: messageId,
        group: groupId,
      }).exec();
      if (!msg) return;

      const group = await Group.findById(groupId).exec();
      if (!group || !group.members.map(String).includes(String(socket.userId))) return;

      if (!msg.deliveredBy.map(String).includes(String(socket.userId))) {
        msg.deliveredBy.push(socket.userId);
        await msg.save();
      }

      const senderId = String(msg.from);
      const otherMemberIds = (group.members || []).map(String).filter((id) => id !== senderId);
      const deliveredIds = (msg.deliveredBy || []).map(String);
      const allReceived =
        otherMemberIds.length > 0 &&
        otherMemberIds.every((id) => deliveredIds.includes(id));
      if (allReceived && String(socket.userId) !== senderId) {
        emitToUser(senderId, "groupMessageAllReceived", {
          groupId,
          messageId: msg._id.toString(),
          clientMessageId: msg.clientMessageId,
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
      const meId = String(socket.userId);
      const isMember = group.members.map(String).includes(meId);
      const isFormer = (group.formerMembers || []).map(String).includes(meId);
      if (!isMember && !isFormer) return;

      const history = await GroupMessage.find({ group: groupId })
        .populate('from', 'name photo')
        .sort({ createdAt: 1 })
        .limit(200)
        .exec();

      // Persist that this member received these messages (drives the sender's
      // single->double tick even if they come online after the send).
      let changedIds = [];
      for (const m of history) {
        if (!m.deliveredBy.map(String).includes(meId)) {
          m.deliveredBy.push(socket.userId);
          await m.save();
          changedIds.push({
            _id: m._id.toString(),
            clientMessageId: m.clientMessageId,
            from: String(m.from),
          });
        }
      }

      const msgs = history.map(m => {
        const senderId = String(m.from._id);
        const otherMemberIds = (group.members || []).map(String).filter(id => id !== senderId);
        const readByIds = (m.readBy || []).map(String);
        const deliveredIds = (m.deliveredBy || []).map(String);
        return {
          _id: m._id,
          groupId,
          from: senderId,
          fromName: m.from.name || 'Unknown',
          fromPhoto: m.from.photo,
          message: m.message,
          file: m.file,
          fileName: m.fileName,
          fileType: m.fileType,
          duration: m.duration,
          forwarded: !!m.forwarded,
          system: !!m.system,
          timestamp: new Date(m.createdAt).getTime(),
          // WhatsApp-style group read tick: green only once every OTHER member
          // has seen the message. `allRead` is computed server-side so every
          // device of the sender agrees on the same tick state.
          readBy: readByIds,
          allRead: otherMemberIds.length > 0 && otherMemberIds.every(id => readByIds.includes(id)),
          deliveredBy: deliveredIds,
          allReceived: otherMemberIds.length > 0 && otherMemberIds.every(id => deliveredIds.includes(id)),
        };
      });

      io.to(socket.id).emit("groupMessagesHistory", { groupId, messages: msgs });

      // If the just-recorded deliveries flipped any message to "all received",
      // tell its sender so their tick updates immediately.
      for (const ch of changedIds) {
        const target = history.find((m) => String(m._id) === String(ch._id));
        if (!target) continue;
        const senderId = ch.from;
        const otherMemberIds = (group.members || []).map(String).filter(id => id !== senderId);
        const deliveredIds = (target.deliveredBy || []).map(String);
        const allReceived = otherMemberIds.length > 0 && otherMemberIds.every(id => deliveredIds.includes(id));
        if (allReceived && senderId !== meId) {
          emitToUser(senderId, "groupMessageAllReceived", {
            groupId,
            messageId: ch._id,
            clientMessageId: ch.clientMessageId,
          });
        }
      }
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

  // ✅ Make another member an admin. Only an existing admin (creator included)
  //    may do this.
  socket.on("group:makeAdmin", async ({ groupId, targetUserId }) => {
    if (!groupId || !targetUserId) return;
    try {
      const group = await Group.findById(groupId).exec();
      if (!group) return;
      const me = String(socket.userId);
      const admins = [String(group.admin), ...(group.admins || []).map(String)];
      if (!admins.includes(me)) return;
      if (!group.members.map(String).includes(String(targetUserId))) return;
      if (!(group.admins || []).map(String).includes(String(targetUserId))) {
        group.admins.push(targetUserId);
        await group.save();
      }
      // Tell everyone the roster changed.
      const populated = await Group.findById(groupId)
        .populate('admin', 'name photo')
        .populate('admins', 'name photo')
        .populate('members', 'name photo')
        .exec();
      group.members.forEach((mid) => {
        emitToUser(mid, "groupRosterChanged", { group: populated });
      });
      const adminIds = [String(populated.admin._id), ...(populated.admins || []).map((a) => String(a._id))];
      emitToUser(String(targetUserId), "groupRosterChanged", { group: populated });
      emitToUser(String(targetUserId), "groupYouAreAdmin", { groupId });
    } catch (err) {
      console.error("group:makeAdmin error:", err.message);
    }
  });

  // ✅ Remove a member from a group. Only an admin may do this, and the
  //    original creator can never be removed. The removed member keeps their
  //    message history but becomes read-only.
  socket.on("group:removeMember", async ({ groupId, targetUserId }) => {
    if (!groupId || !targetUserId) return;
    try {
      const group = await Group.findById(groupId).exec();
      if (!group) return;
      const me = String(socket.userId);
      const admins = [String(group.admin), ...(group.admins || []).map(String)];
      if (!admins.includes(me)) return;
      if (String(targetUserId) === String(group.admin)) return; // creator is sacred
      if (!group.members.map(String).includes(String(targetUserId))) return;

      group.members = group.members.filter((m) => String(m) !== String(targetUserId));
      group.admins = (group.admins || []).filter((m) => String(m) !== String(targetUserId));
      if (!(group.formerMembers || []).map(String).includes(String(targetUserId))) {
        group.formerMembers.push(targetUserId);
      }
      await group.save();

      // System history message for everyone (including the removed user).
      const adminName = await User.findById(socket.userId).select('name').lean().exec();
      const targetName = await User.findById(targetUserId).select('name').lean().exec();
      const sysMsg = await GroupMessage.create({
        group: groupId,
        from: socket.userId,
        message: `${adminName?.name || 'Someone'} removed ${targetName?.name || 'a member'}`,
        system: true,
        clientMessageId: `sys-rem-${Date.now()}`,
        deliveredBy: group.members.map(String),
      });

      const payload = {
        groupId,
        message: sysMsg.message,
        system: true,
        _id: sysMsg._id,
        from: socket.userId,
        fromName: adminName?.name || 'System',
        fromPhoto: '',
        timestamp: sysMsg.createdAt.getTime(),
      };

      // Everyone remaining sees the roster change + system message.
      group.members.forEach((mid) => emitToUser(mid, "groupRosterChanged", { group }));
      group.members.forEach((mid) => emitToUser(mid, "receiveGroupMessage", payload));
      // ALSO broadcast the roster+system message to the removed user's devices.
      emitToUser(String(targetUserId), "groupRosterChanged", { group });
      emitToUser(String(targetUserId), "receiveGroupMessage", payload);

      // Tell the removed user they've been removed.
      emitToUser(String(targetUserId), "groupYouWereRemoved", { groupId });
    } catch (err) {
      console.error("group:removeMember error:", err.message);
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

  // In-memory group call registry: callId -> { type, groupId, callerId, callerName, members:Set<userId> }
  const groupCalls = new Map();

  // In-memory active 1:1 call registry so history ALWAYS records the ORIGINAL
  // initiator as caller, regardless of which side rejects/ends/times out.
  const activeCalls = new Map(); // callId -> { caller, callee, type }

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
    activeCalls.set(callId, { caller: String(socket.userId), callee: String(to), type });
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
    activeCalls.set(callId, { caller: String(socket.userId), callee: null, type });
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
  });

  // Member leaves a group call -> notify everyone else (and close my other devices).
  socket.on('call:memberLeft', ({ to, callId, type }) => {
    const ca = groupCalls.get(callId);
    if (!ca) return;
    ca.members.delete(String(socket.userId));
    [...ca.members].forEach((mid) => emitToUser(mid, 'call:memberLeft', { callId, userId: String(socket.userId), type }));
    emitToUser(socket.userId, 'call:endedLocal', { callId });
    if (ca.members.size === 0) groupCalls.delete(callId);
  });

  // Member ends their group-call session -> log their own record + notify others.
  socket.on('call:groupEnd', ({ groupId, callId, type, durationSec, callerName }) => {
    const secs = Math.max(0, Math.round(durationSec || 0));
    logCall(socket.userId, socket.userId, type, secs > 0 ? 'ended' : 'missed', secs, { groupId, callerName });
    const ca = groupCalls.get(callId);
    if (ca) {
      ca.members.delete(String(socket.userId));
      [...ca.members].forEach((mid) => emitToUser(mid, 'call:memberLeft', { callId, userId: String(socket.userId), type }));
      if (ca.members.size === 0) groupCalls.delete(callId);
    }
    emitToUser(socket.userId, 'call:endedLocal', { callId });
  });

  // Caller cancels a group ring (nobody answered) -> one missed group record.
  socket.on('call:groupTimeout', ({ groupId, callId, type, callerName }) => {
    logCall(socket.userId, socket.userId, type, 'missed', 0, { groupId, callerName });
    groupCalls.delete(callId);
    emitToUser(socket.userId, 'call:endedLocal', { callId });
  });

  // Callee accepts -> caller opens the active call UI. Also tell my OTHER
  // sockets to stop ringing, since this device is joining.
  socket.on('call:accept', ({ to, callId, type }) => {
    if (!to || !callId) return;
    emitToUser(to, 'call:accepted', { callId, type });
    emitToUser(socket.userId, 'call:ringEnded', { callId });
  });

  // Callee declines -> mark missed for the caller. Every device of the callee
  // must stop ringing (item 3: rejecting on one device ends the ring on all).
  socket.on('call:reject', ({ to, callId, type }) => {
    if (!to) return;
    const entry = activeCalls.get(callId);
    const callerId = entry?.caller || String(to);
    const calleeId = entry?.callee || String(socket.userId);
    logCall(callerId, calleeId, type, 'missed', 0);
    activeCalls.delete(callId);
    emitToUser(socket.userId, 'call:rejectedRemote', { callId, type });
    emitToUser(to, 'call:rejected', { callId, type });
  });

  // Either side hangs up -> both close; the ORIGINAL caller records the call so
  // both accounts agree on direction no matter who hangs up first.
  socket.on('call:end', ({ to, callId, type, durationSec }) => {
    if (!to) return;
    const secs = Math.max(0, Math.round(durationSec || 0));
    const entry = activeCalls.get(callId);
    const callerId = entry?.caller || String(socket.userId);
    const calleeId = entry?.callee || String(to);
    logCall(callerId, calleeId, type, secs > 0 ? 'ended' : 'missed', secs);
    activeCalls.delete(callId);
    emitToUser(socket.userId, 'call:endedLocal', { callId });
    emitToUser(to, 'call:ended', { callId });
  });

  // Caller timeout (callee never answered) -> mark missed on all caller devices.
  socket.on('call:timeout', ({ to, callId, type }) => {
    if (!to) return;
    const entry = activeCalls.get(callId);
    const callerId = entry?.caller || String(socket.userId);
    const calleeId = entry?.callee || String(to);
    logCall(callerId, calleeId, type, 'missed', 0);
    activeCalls.delete(callId);
    emitToUser(to, 'call:timedOut', { callId });
    emitToUser(socket.userId, 'call:timedOutS', { callId });
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
            to: msg.to,
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
            messageId: msg.clientMessageId
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