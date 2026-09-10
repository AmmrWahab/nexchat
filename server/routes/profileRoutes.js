// server/routes/profileRoutes.js — profile, name/about editing, block, report
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import User from '../models/User.js';
import Report from '../models/Report.js';

const router = Router();
const verifyAsync = promisify(jwt.verify);

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

function profilePayload(me, target) {
  return {
    id: String(target._id),
    name: target.name,
    email: target.email,
    photo: target.photo,
    about: target.about || '',
    lastSeen: target.lastSeen ? new Date(target.lastSeen).getTime() : null,
    blocked: (me.blocked || []).map(String).includes(String(target._id)),
    blockedBy: (target.blocked || []).map(String).includes(String(me._id)),
  };
}

// GET /api/profile/me — my own profile (about, photo, name, blocked list)
router.get('/profile/me', auth, async (req, res) => {
  try {
    const me = await User.findById(req.userId);
    if (!me) return res.status(404).json({ message: 'User not found' });
    res.json({
      id: String(me._id),
      name: me.name,
      email: me.email,
      photo: me.photo,
      about: me.about || '',
      lastSeen: me.lastSeen ? new Date(me.lastSeen).getTime() : null,
      blocked: (me.blocked || []).map(String),
    });
  } catch (err) {
    console.error('GET /profile/me error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/profile/:userId — another user's profile with block flags
router.get('/profile/:userId', auth, async (req, res) => {
  try {
    const me = await User.findById(req.userId);
    const target = await User.findById(req.params.userId);
    if (!me || !target) return res.status(404).json({ message: 'User not found' });
    res.json({ profile: profilePayload(me, target) });
  } catch (err) {
    console.error('GET /profile/:userId error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/profile/me — update name and/or about
router.patch('/profile/me', auth, async (req, res) => {
  const { name, about } = req.body || {};
  try {
    const me = await User.findById(req.userId);
    if (!me) return res.status(404).json({ message: 'User not found' });
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 10) {
        return res.status(400).json({ message: 'Name must be between 1 and 10 characters' });
      }
      me.name = trimmed;
    }
    if (typeof about === 'string') {
      me.about = about.trim().slice(0, 100);
    }
    await me.save();
    res.json({
      id: String(me._id),
      name: me.name,
      about: me.about,
      photo: me.photo,
    });
  } catch (err) {
    console.error('PATCH /profile/me error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/profile/:userId/block — block a user
router.post('/profile/:userId/block', auth, async (req, res) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (String(target._id) === String(req.userId)) {
      return res.status(400).json({ message: 'Cannot block yourself' });
    }
    const me = await User.findById(req.userId);
    if (!me.blocked.some((id) => String(id) === String(req.params.userId))) {
      me.blocked.push(req.params.userId);
      await me.save();
    }
    res.json({ blocked: true });
  } catch (err) {
    console.error('POST /profile/:userId/block error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/profile/:userId/block — unblock a user
router.delete('/profile/:userId/block', auth, async (req, res) => {
  try {
    const me = await User.findById(req.userId);
    if (!me) return res.status(404).json({ message: 'User not found' });
    me.blocked = me.blocked.filter((id) => String(id) !== String(req.params.userId));
    await me.save();
    res.json({ blocked: false });
  } catch (err) {
    console.error('DELETE /profile/:userId/block error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/profile/:userId/report — report a user
router.post('/profile/:userId/report', auth, async (req, res) => {
  const { reason } = req.body || {};
  try {
    if (String(req.params.userId) === String(req.userId)) {
      return res.status(400).json({ message: 'Cannot report yourself' });
    }
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ message: 'User not found' });
    const existing = await Report.findOne({ reporter: req.userId, reported: req.params.userId });
    if (existing) {
      existing.reason = String(reason || '').slice(0, 500);
      await existing.save();
      return res.json({ reported: true });
    }
    await Report.create({
      reporter: req.userId,
      reported: req.params.userId,
      reason: String(reason || '').slice(0, 500),
    });
    res.json({ reported: true });
  } catch (err) {
    console.error('POST /profile/:userId/report error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;