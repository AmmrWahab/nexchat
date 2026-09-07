import mongoose from "mongoose";

const groupMessageSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true },
  from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  message: { type: String, default: "" },
  file: { type: String, default: null },
  fileName: { type: String, default: null },
  fileType: { type: String, default: null },
  clientMessageId: String,
  delivered: { type: Boolean, default: false },
  read: { type: Boolean, default: false },
  // Users who have actually seen this message (drives WhatsApp-style read ticks)
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("GroupMessage", groupMessageSchema);
