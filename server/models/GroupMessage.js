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
  systemType: { type: String, default: null }, // e.g. 'memberRemoved', 'memberDemoted', 'memberMadeAdmin'
  // The affected user of a system event (e.g. the member who was removed) so
  // each viewer can be shown the right wording ("X removed you" / "You removed
  // X" / "X removed Y"). null for ordinary messages.
  target: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  // Personal system notice (e.g. legacy "X removed you"): only delivered to
  // this user. null/absent means the message is visible to every member.
  visibleTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  createdAt: { type: Date, default: Date.now }
});

// Hot-path index: every group-history query and the per-group "last message"
// lookup filters on `group` sorted by createdAt. Without it, loading groups or
// opening a group scans the entire GroupMessage collection.
groupMessageSchema.index({ group: 1, createdAt: -1 });

export default mongoose.model("GroupMessage", groupMessageSchema);
