import mongoose from "mongoose";

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  dp: { type: String, default: null },
  admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // Additional admins promoted by the creator/other admins. The original
  // creator (the `admin` field) is the root admin and can never be removed.
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // Members who were removed by an admin. Kept so a removed member can still
  // open the group and read the history they had access to, while receiving
  // no further real-time updates.
  removedMembers: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    removedAt: { type: Date, default: Date.now },
  }],
}, {
  timestamps: true
});

export default mongoose.model("Group", groupSchema);
