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
import path from 'path'; // ✅ Add this
import { fileURLToPath } from 'url';
import Message from "./models/Message.js"; // add this on top
import { promisify } from 'util';
const verifyAsync = promisify(jwt.verify);

// ✅ Add this to get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config();

const app = express();
const server = http.createServer(app);

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://192.168.1.190:5173'  // ✅ Match EXACTLY what frontend uses
    ],
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://192.168.1.190:5173'
  ],
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

// Google Auth Routes
app.get('/api/auth/google',
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

    // ✅ Redirect to frontend with token
    res.redirect(`http://localhost:5173/dashboard?token=${token}`);
  }
);

// Test route
app.get('/', (req, res) => {
  res.send('<h1>NexChat Backend is Running ✅</h1>');
});

// Socket.IO Authentication & Connection
// Socket.IO Authentication & Connection
const userSocketMap = new Map(); // userId → socketId

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
      userSocketMap.delete(socket.userId);

      // ✅ Notify others this user is offline
      io.emit('userStatus', {
        userId: socket.userId,
        isOnline: false,
        lastSeen: new Date().toISOString()
      });
    } catch (err) {
      console.error('Disconnect error:', err.message);
    }
  });

  // ✅ Mark as online only after fully connected
  await User.findByIdAndUpdate(socket.userId, { lastSeen: Date.now() });
  userSocketMap.set(socket.userId, socket.id);

  // ✅ Emit online status
  io.emit('userStatus', {
    userId: socket.userId,
    isOnline: true,
    lastSeen: null
  });

  

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
      const senderSocketId = userSocketMap.get(msg.from._id.toString());
      if (senderSocketId) {
        io.to(senderSocketId).emit("messageDelivered", {
          chatId: msg.to.toString(),
          messageId: msg.clientMessageId
        });
      }

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
  const receiverSocketId = userSocketMap.get(to);
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
      delivered: !!receiverSocketId,
      clientMessageId: data.messageId 
    });
     console.log("✅ [SUCCESS] Saved to DB:", {
      _id: newMsg._id,
      message: newMsg.message,
      delivered: newMsg.delivered,
      clientMessageId: newMsg.clientMessageId
    });
    

    if (receiverSocketId) {
      // ✅ Send message to recipient
      io.to(receiverSocketId).emit("receiveMessage", {
        
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

    const senderSocketId = userSocketMap.get(chatId);
    if (senderSocketId) {
      io.to(senderSocketId).emit("messageRead", {
        chatId: readerId,
        readerId,
        readerName: receiver.name,
        timestamp: Date.now(),
      });
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