import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  message: { type: String, default: "" },

  file: { type: String, default: null },       // File path or base64
  fileName: { type: String, default: null },
  fileType: { type: String, default: null },

  delivered: { type: Boolean, default: false },
  read: { type: Boolean, default: false },
  clientMessageId: String,

  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Message", messageSchema);
