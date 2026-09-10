import mongoose from "mongoose";

const groupMessageSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true },
  from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  message: { type: String, default: "" },
  file: { type: String, default: null },
  fileName: { type: String, default: null },
  fileType: { type: String, default: null },
  duration: { type: Number, default: null },    // seconds (voice messages)
  clientMessageId: String,
  delivered: { type: Boolean, default: false },
  read: { type: Boolean, default: false },
  // Users who have actually received this message on one of their devices
  // (drives WhatsApp-style single->double ticks: double once every OTHER
  // member has received it).
  deliveredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // Users who have actually seen this message (drives WhatsApp-style read ticks)
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // Forwarded copies carry this flag so the label renders on the receiver side.
  forwarded: { type: Boolean, default: false },
  // System messages (member added/removed, group created, etc.) render centered.
  system: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("GroupMessage", groupMessageSchema);
