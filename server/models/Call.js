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
  createdAt: { type: Date, default: Date.now },
});

callSchema.index({ caller: 1, createdAt: -1 });
callSchema.index({ callee: 1, createdAt: -1 });

export default mongoose.model("Call", callSchema);