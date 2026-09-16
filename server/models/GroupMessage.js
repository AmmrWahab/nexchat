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
  isForwarded: { type: Boolean, default: false },
  delivered: { type: Boolean, default: false },
  read: { type: Boolean, default: false },
  // Users who have actually seen this message (drives WhatsApp-style read ticks)
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // Members whose device has actually received this message (drives the
  // per-member delivery tick: a group message only turns ✓✓ once every other
  // member is listed here)
  deliveredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // System/history entries (e.g. "X removed Y", "X made Y admin"). Styled
  // differently in the chat and never attributed to a real sender.
  isSystem: { type: Boolean, default: false },
  systemType: { type: String, default: null }, // e.g. 'memberRemoved', 'memberRemovedYou', 'memberMadeAdmin'
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("GroupMessage", groupMessageSchema);
