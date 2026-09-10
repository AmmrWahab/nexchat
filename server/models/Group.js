import mongoose from "mongoose";

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  dp: { type: String, default: null },
  admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  // Additional admins (the creator in `admin` is implicitly an admin).
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // Members who were removed (they keep read-only access to history).
  formerMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
}, {
  timestamps: true
});

export default mongoose.model("Group", groupSchema);
