// server/routes/statusRoutes.js
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import Status from '../models/Status.js';
import User from '../models/User.js';

const router = Router();
const verifyAsync = promisify(jwt.verify);

const STATUS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours, WhatsApp-style

async function auth(req, res, next) {
  let token = req.headers.authorization?.replace('Bearer ', '') || req.body?.token;
  if (!token) return res.status(401).json({ message: 'No token provided' });
  try {
    const decoded = await verifyAsync(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// Users who can see <ownerId>'s statuses: the people they chat with.
// A status is visible to a viewer if EITHER direction added the other as a
// contact (they "chat with" each other), so no matter who added whom the feed
// works the same for both people.
export async function getStatusViewerIds(ownerId) {
  const owner = await User.findById(ownerId).select('contacts').lean().exec();
  const ownerAdded = (owner?.contacts || []).map(String);
  const addedOwner = await User.find({ contacts: ownerId }).select('_id').lean().exec();
  const ids = new Set([
    String(ownerId),
    ...ownerAdded,
    ...addedOwner.map(u => String(u._id)),
  ]);
  return [...ids];
}

// Serialize a status doc for a specific viewer (includes the `viewed` flag so
// the green ring can turn grey once they have seen it).
export function makeStatusPayload(status, viewerId) {
  const uid = String(status.user?._id || status.user);
  return {
    _id: String(status._id),
    user: {
      id: uid,
      name: status.user?.name || 'Unknown',
      photo: status.user?.photo || 'https://via.placeholder.com/50',
    },
    type: status.type,
    text: status.text || '',
    bg: status.bg || 'default',
    file: status.file || '',
    createdAt: new Date(status.createdAt).getTime(),
    viewed: (status.viewers || []).map(String).includes(String(viewerId)),
  };
}

// GET /api/status/feed — statuses from the user's contacts (and their own),
// newest first, restricted to the last 24 hours.
router.get('/status/feed', auth, async (req, res) => {
  try {
    const candidateIds = await getStatusViewerIds(req.userId);
    const since = new Date(Date.now() - STATUS_TTL_MS);
    const statuses = await Status.find({
      user: { $in: candidateIds },
      createdAt: { $gte: since },
    })
      .populate('user', 'name photo')
      .sort({ createdAt: -1 })
      .limit(200)
      .exec();

    res.json({ statuses: statuses.map(s => makeStatusPayload(s, req.userId)) });
  } catch (err) {
    console.error('Get status feed error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/status/:id/view — mark a status as seen by the current user
router.post('/status/:id/view', auth, async (req, res) => {
  try {
    const status = await Status.findById(req.params.id).exec();
    if (!status) return res.status(404).json({ message: 'Status not found' });
    if (!status.viewers.map(String).includes(String(req.userId))) {
      status.viewers.push(req.userId);
      await status.save();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Mark status viewed error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;