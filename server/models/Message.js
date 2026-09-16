import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  message: { type: String, default: "" },

  file: { type: String, default: null },       // File path or base64
  fileName: { type: String, default: null },
  fileType: { type: String, default: null },
  duration: { type: Number, default: null },    // seconds (voice messages)

  replyTo: {
    sender: { type: String, default: null },
    text: { type: String, default: null },
    messageId: { type: String, default: null },
    statusId: { type: String, default: null },   // original status being replied to
    senderId: { type: String, default: null },
    _id: false,
  },

  delivered: { type: Boolean, default: false },
  read: { type: Boolean, default: false },
  blocked: { type: Boolean, default: false }, // sent while a block was active: kept for the SENDER's view only (single tick), never delivered
  clientMessageId: String,
  isForwarded: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now }
});

// Hot-path indexes: the DM history + read-receipt queries filter on (from, to)
// and (to, from) sorted by createdAt. Without these every fetchMessages /
// lastMessage call scans the whole collection, which is what made Chats and
// Groups feel slow right after a refresh.
messageSchema.index({ from: 1, to: 1, createdAt: -1 });
messageSchema.index({ to: 1, from: 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);
