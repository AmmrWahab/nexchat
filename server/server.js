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
import path from 'path'; // ✅ Add this
import { fileURLToPath } from 'url';
import Message from "./models/Message.js"; // add this on top
import groupRoutes from './routes/groupRoutes.js'; // ✅ Group routes
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



io.on('connection', async (socket) => {
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

  // ✅ Mark as online only after fully connected
  await User.findByIdAndUpdate(socket.userId, { lastSeen: Date.now() });

  // Track this socket id in the user's set of connected sockets
  if (!userSocketMap.has(socket.userId)) {
    userSocketMap.set(socket.userId, new Set());
  }
  userSocketMap.get(socket.userId).add(socket.id);

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
// ✅ Deliver undelivered messages
try {
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
  console.error("❌ Error delivering stored messages:", err);
}
  

  // ✅ Handle new message
  // ✅ Inside socket.on("sendMessage", async (data) => { ... })

socket.on("sendMessage", async (data) => {
    console.log("📨 [DEBUG] Full data received:", JSON.stringify(data, null, 2)); // 🔥 Full payload
  const { to, message, from, file, fileName, fileType, replyTo, messageId } = data; // 👈 Make sure you receive `messageId`
    console.log("📄 [DEBUG] Extracted fields:", { to, message, from, messageId }); // 🔥 Check values
  const receiverSocketIds = getSocketIds(to);
  if (!from || !to) {
    console.error("❌ Invalid from/to:", { from, to });
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
      replyTo: replyTo ? {
        sender: replyTo.sender,
        text: replyTo.text,
        messageId: replyTo.messageId
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
      // ✅ Send message to ALL of the recipient's connected sockets
      receiverSocketIds.forEach((sid) => {
        io.to(sid).emit("receiveMessage", {
          
          _id: newMsg._id,
          from,
          fromName: sender.name,
          message,
          file,
          fileName,
          fileType,
          replyTo: replyTo,
          timestamp: newMsg.createdAt.getTime(),
          messageId // 👈 Send back to client
        });
      });

      // ✅ BONUS: Notify sender that their message was delivered
      socket.emit("messageDelivered", {
        chatId: to,
        messageId: messageId || newMsg._id.toString()
      });
    } else {
      console.log(`📥 Stored undelivered message for ${to}`);
    }
  } catch (err) {
    console.error("❌ [CRITICAL] Error in sendMessage:", err); // Full error
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
    const { groupId, message, file, fileName, fileType, messageId } = data;
    if (!groupId) return;
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
        timestamp: newMsg.createdAt.getTime(),
        messageId
      };

      // Send to every member's sockets (except sender's own — sender already shows optimistically)
      group.members.forEach((memberId) => {
        const sid = String(memberId) === String(socket.userId) ? socket.id : null;
        emitToUser(memberId, "receiveGroupMessage", payload, [socket.id]);
      });

      // Confirm deliver to sender
      socket.emit("groupMessageDelivered", { groupId, messageId: messageId || newMsg._id.toString() });
    } catch (err) {
      console.error("sendGroupMessage error:", err.message);
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

      const msgs = history.map(m => ({
        _id: m._id,
        groupId,
        from: String(m.from._id),
        fromName: m.from.name || 'Unknown',
        fromPhoto: m.from.photo,
        message: m.message,
        file: m.file,
        fileName: m.fileName,
        fileType: m.fileType,
        timestamp: new Date(m.createdAt).getTime(),
      }));

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