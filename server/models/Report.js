import mongoose from "mongoose";

const reportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reported: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reason: { type: String, default: "", maxlength: 500 },
}, {
  timestamps: true,
});

reportSchema.index({ reporter: 1, reported: 1 }, { unique: true });

export default mongoose.model("Report", reportSchema);