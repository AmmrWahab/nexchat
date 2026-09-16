import mongoose from "mongoose";

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  dp: { type: String, default: null },
  admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // Additional admins promoted by the creator/other admins. The original
  // creator (the `admin` field) is the root admin and can never be removed.
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  // Permissions for the group. `sendMessages`: 'everyone' (default) lets any
  // member send, 'admins' restricts sending to admins only. `addMembers`:
  // 'everyone' (default) lets any member add new members, 'admins' restricts
  // the Add-members action to admins only. Both are enforced server-side.
  sendMessages: { type: String, enum: ['everyone', 'admins'], default: 'everyone' },
  addMembers: { type: String, enum: ['everyone', 'admins'], default: 'everyone' },
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

// The group list loads every group the user is (or was) a member of, matched
// on these two array fields and sorted by newest first.
groupSchema.index({ members: 1, createdAt: -1 });
groupSchema.index({ 'removedMembers.user': 1 });

export default mongoose.model("Group", groupSchema);
