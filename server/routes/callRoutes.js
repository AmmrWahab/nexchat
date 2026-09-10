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

    const calls = rows
      .map((c) => {
        // A deleted/cleared account leaves a null populate. We must not throw,
        // otherwise the ENTIRE history 500s and the user sees no calls at all.
        try {
          const callerId = c.caller?._id ? String(c.caller._id) : null;
          const calleeId = c.callee?._id ? String(c.callee._id) : null;
          const isGroupRecord = !!c.groupId;
          const iCalled = !isGroupRecord && callerId === String(userId);
          const other = iCalled ? c.callee : c.caller;

          // Group-call records ar caller==callee==self and carry the group id.
          if (isGroupRecord) {
            const otherName =
              c.callerName ||
              (other?.name || 'Unknown');
            return {
              id: c._id.toString(),
              userId: callerId || calleeId || String(userId),
              name: otherName,
              photo: other?.photo || 'https://via.placeholder.com/50',
              type: c.status === 'missed' ? 'outgoing' : 'outgoing',
              video: c.type === 'video',
              time: c.createdAt.getTime(),
              durationSec: c.durationSec || 0,
              direction: c.status === 'missed' ? 'missed' : 'outgoing',
              groupId: String(c.groupId),
              callerName: c.callerName || '',
            };
          }

          if (!other || !other._id) return null; // partner account gone — skip row
          return {
            id: c._id.toString(),
            userId: String(other._id),
            name: other.name || 'Unknown',
            photo: other.photo || 'https://via.placeholder.com/50',
            type: iCalled ? 'outgoing' : 'missed',
            video: c.type === 'video',
            time: c.createdAt.getTime(),
            durationSec: c.durationSec || 0,
            // classify: outgoing / incoming / missed
            direction: c.status === 'missed' ? 'missed' : (iCalled ? 'outgoing' : 'incoming'),
            // group-call info (if any)
            groupId: c.groupId ? String(c.groupId) : null,
            callerName: c.callerName || '',
          };
        } catch (err) {
          return null;
        }
      })
      .filter(Boolean);
    res.json({ calls });
  } catch (err) {
    console.error("GET /api/calls error:", err);
    res.status(500).json({ error: "Failed to load call history" });
  }
});

export default router;