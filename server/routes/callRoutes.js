import express from "express";
import jwt from "jsonwebtoken";
import { promisify } from "util";
import User from "../models/User.js";
import Call from "../models/Call.js";

const router = express.Router();
const verifyAsync = promisify(jwt.verify);

function getUserId(req) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return null;
  return verifyAsync(token, process.env.JWT_SECRET)
    .then((d) => d.userId)
    .catch(() => null);
}

// GET /api/calls -> the current user's call history with the other party + direction
router.get("/calls", async (req, res) => {
  const userId = await getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const rows = await Call.find({
      $or: [{ caller: userId }, { callee: userId }],
    })
      .populate("caller", "name photo lastSeen")
      .populate("callee", "name photo lastSeen")
      .sort({ createdAt: -1 })
      .limit(100)
      .exec();

    const calls = rows.map((c) => {
      const iCalled = String(c.caller._id) === String(userId);
      const other = iCalled ? c.callee : c.caller;
      return {
        id: c._id.toString(),
        userId: String(other._id),
        name: other.name || "Unknown",
        photo: other.photo || "https://via.placeholder.com/50",
        type: iCalled ? "outgoing" : "missed",
        video: c.type === "video",
        time: c.createdAt.getTime(),
        durationSec: c.durationSec || 0,
        // classify: outgoing / incoming / missed
        direction: c.status === "missed" ? "missed" : (iCalled ? "outgoing" : "incoming"),
      };
    });
    res.json({ calls });
  } catch (err) {
    console.error("GET /api/calls error:", err);
    res.status(500).json({ error: "Failed to load call history" });
  }
});

export default router;