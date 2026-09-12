import mongoose from "mongoose";

const callSchema = new mongoose.Schema({
  caller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  callee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, enum: ["voice", "video"], default: "voice" },
  // Direction from the perspective of each participant is derived from
  // caller/callee. status records how the call ended:
  //   missed    -> callee never answered
  //   outgoing  -> this record is for the caller and the call connected
  //                (we store one record per participant via direction)
  status: { type: String, enum: ["missed", "ended"], default: "ended" },
  durationSec: { type: Number, default: 0 },
  // A missed incoming call is "unread" (drives the contact-list green badge)
  // until the recipient sees it. True only for missed calls where the callee
  // was away when the call ended; a callee who was present (online) is never
  // given an unread badge for a call they saw coming in. Group rows and ended
  // calls never use/need it.
  calleeRead: { type: Boolean, default: false },
  // Group calls: caller = the member who logged the call; groupId points at
  // the group chat so history rows can be interleaved in the thread.
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: "Group", default: null },
  callerName: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

callSchema.index({ caller: 1, createdAt: -1 });
callSchema.index({ callee: 1, createdAt: -1 });

export default mongoose.model("Call", callSchema);