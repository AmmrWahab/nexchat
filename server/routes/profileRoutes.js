// server/routes/profileRoutes.js
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import User from '../models/User.js';
import Group from '../models/Group.js';

const verifyAsync = promisify(jwt.verify);

// Simple JWT auth middleware (reads token from Authorization header or body)
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

const DEFAULT_PHOTO = 'https://via.placeholder.com/150';
const MAX_PHOTO_BASE64 = 2 * 1024 * 1024; // ~1.5MB image as base64

export default function createProfileRouter(io) {
  const router = Router();

  // Emit an event to every live socket belonging to a set of users.
  function emitToUsers(userIds, event, payload) {
    const targets = new Set((userIds || []).map((id) => String(id)));
    io.sockets.sockets.forEach((socket) => {
      if (socket.userId && targets.has(String(socket.userId))) {
        socket.emit(event, payload);
      }
    });
  }

  // GET /api/profile/me — the current user's own profile
  router.get('/me', auth, async (req, res) => {
    try {
      const me = await User.findById(req.userId).select('name email photo about lastSeen');
      if (!me) return res.status(404).json({ message: 'User not found' });
      res.json({
        user: {
          id: String(me._id),
          name: me.name,
          email: me.email,
          photo: me.photo || DEFAULT_PHOTO,
          about: me.about || '',
          lastSeen: me.lastSeen,
        },
      });
    } catch (err) {
      console.error('Get profile error:', err.message);
      res.status(500).json({ message: 'Server error' });
    }
  });

  // PATCH /api/profile/me — update name / about / photo
  router.patch('/me', auth, async (req, res) => {
    const { name, about, photo } = req.body || {};
    const update = {};
    let changed = false;

    if (name !== undefined) {
      const clean = typeof name === 'string' ? name.trim() : '';
      if (!clean) return res.status(400).json({ message: 'Name is required' });
      if (clean.length > 10) return res.status(400).json({ message: 'Name must be 10 characters or fewer' });
      if (!/^[A-Za-z\s]+$/.test(clean)) return res.status(400).json({ message: 'Name can only contain alphabetic characters' });
      update.name = clean;
      changed = true;
    }

    if (about !== undefined) {
      const clean = typeof about === 'string' ? about.trim() : '';
      if (clean.length > 100) return res.status(400).json({ message: 'About must be 100 characters or fewer' });
      update.about = clean;
      changed = true;
    }

    if (photo !== undefined) {
      if (photo === null || photo === '') {
        update.photo = DEFAULT_PHOTO;
      } else {
        if (typeof photo !== 'string' || (!photo.startsWith('data:image/') && !/^https?:\/\//.test(photo))) {
          return res.status(400).json({ message: 'Invalid profile photo' });
        }
        if (photo.length > MAX_PHOTO_BASE64) {
          return res.status(400).json({ message: 'Profile photo is too large' });
        }
        update.photo = photo;
      }
      changed = true;
    }

    if (!changed) return res.status(400).json({ message: 'Nothing to update' });

    try {
      const me = await User.findByIdAndUpdate(req.userId, update, { new: true }).select('name email photo about lastSeen contacts');
      if (!me) return res.status(404).json({ message: 'User not found' });

      // Notify contacts + group members so their lists refresh live.
      const groups = await Group.find({ members: req.userId }).select('members');
      const targets = new Set([String(me._id)]);
      (me.contacts || []).forEach((c) => targets.add(String(c)));
      groups.forEach((g) => (g.members || []).forEach((m) => targets.add(String(m))));
      emitToUsers([...targets], 'user:profileUpdated', { userId: String(me._id), changed: Object.keys(update) });

      res.json({
        user: {
          id: String(me._id),
          name: me.name,
          email: me.email,
          photo: me.photo || DEFAULT_PHOTO,
          about: me.about || '',
          lastSeen: me.lastSeen,
        },
      });
    } catch (err) {
      console.error('Update profile error:', err.message);
      res.status(500).json({ message: 'Server error' });
    }
  });

  // GET /api/profile/:id — view another user's profile.
  // The About line is only exposed to the user themself or their contacts;
  // everyone else only sees the display name + photo.
  router.get('/:id', auth, async (req, res) => {
    const targetId = req.params?.id;
    if (!targetId) return res.status(400).json({ message: 'id required' });
    try {
      const target = await User.findById(targetId).select('name email photo about lastSeen');
      if (!target) return res.status(404).json({ message: 'User not found' });

      let isOwn = false;
      let isContact = false;
      if (String(targetId) === String(req.userId)) {
        isOwn = true;
      } else {
        const me = await User.findById(req.userId).select('contacts');
        isContact = (me?.contacts || []).some((c) => String(c) === String(targetId));
      }

      const body = {
        id: String(target._id),
        name: target.name,
        photo: target.photo || DEFAULT_PHOTO,
      };
      if (isOwn || isContact) {
        body.about = target.about || '';
        body.email = target.email;
        body.lastSeen = target.lastSeen;
      }
      res.json({ user: body });
    } catch (err) {
      console.error('Get user profile error:', err.message);
      res.status(500).json({ message: 'Server error' });
    }
  });

  return router;
}