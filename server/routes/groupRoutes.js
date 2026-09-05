// server/routes/groupRoutes.js
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import Group from '../models/Group.js';
import GroupMessage from '../models/GroupMessage.js';
import User from '../models/User.js';

const router = Router();
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

// POST /api/groups/create — create a group and add members
router.post('/groups/create', auth, async (req, res) => {
  const { name, dp, members } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Group name required' });
  const memberIds = Array.isArray(members) && members.length ? members : [];

  try {
    const admin = req.userId;
    // Ensure admin is in members, dedupe, no duplicates
    const memberSet = new Set(memberIds.map(String));
    memberSet.add(String(admin));
    const finalMembers = [...memberSet].map(m => m);

    const group = await Group.create({
      name: name.trim(),
      dp: dp || null,
      admin,
      members: finalMembers
    });

    const populated = await Group.findById(group._id)
      .populate('admin', 'name photo')
      .populate('members', 'name photo');

    res.status(201).json({ group: populated });
  } catch (err) {
    console.error('Create group error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/groups — return all groups the current user is a member of
router.get('/groups', auth, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.userId })
      .populate('admin', 'name photo')
      .populate('members', 'name photo')
      .sort({ createdAt: -1 });

    // Attach the last message + time of each group so the list preview
    // updates immediately on refresh without depending on socket timing.
    const withLast = await Promise.all(groups.map(async (group) => {
      const last = await GroupMessage.findOne({ group: group._id })
        .populate('from', 'name photo')
        .sort({ createdAt: -1 })
        .exec();
      const g = group.toObject();
      if (last) {
        g.lastMessage = {
          text: last.message,
          file: last.file,
          fileName: last.fileName,
          fileType: last.fileType,
          from: String(last.from?._id || last.from),
          fromName: last.from?.name || 'Unknown',
          fromPhoto: last.from?.photo,
          timestamp: new Date(last.createdAt).getTime(),
        };
      }
      return g;
    }));

    res.json({ groups: withLast });
  } catch (err) {
    console.error('Get groups error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users — return all registered users (so contacts show on any device)
router.get('/users', auth, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.userId } }).select('name email photo _id');
    res.json({ users });
  } catch (err) {
    console.error('Get users error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/contacts — return the current user's private address book
router.get('/contacts', auth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).populate('contacts', 'name email photo lastSeen');
    res.json({ contacts: me?.contacts || [] });
  } catch (err) {
    console.error('Get contacts error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/contacts — add a user to the current user's address book
router.post('/contacts', auth, async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ message: 'userId required' });
  if (String(userId) === String(req.userId)) return res.status(400).json({ message: 'Cannot add yourself' });
  try {
    const target = await User.findById(userId);
    if (!target) return res.status(404).json({ message: 'User not found' });
    const me = await User.findById(req.userId);
    if (!me) return res.status(404).json({ message: 'User not found' });
    if (!me.contacts.some((id) => String(id) === String(userId))) {
      me.contacts.push(userId);
      await me.save();
    }
    res.status(201).json({
      contact: { id: target._id, name: target.name, email: target.email, photo: target.photo, lastSeen: target.lastSeen },
    });
  } catch (err) {
    console.error('Add contact error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/contacts/:contactId — remove a user from the current user's address book
router.delete('/contacts/:contactId', auth, async (req, res) => {
  const contactId = req.params?.contactId;
  if (!contactId) return res.status(400).json({ message: 'contactId required' });
  try {
    const me = await User.findById(req.userId);
    if (!me) return res.status(404).json({ message: 'User not found' });
    me.contacts = me.contacts.filter((id) => String(id) !== String(contactId));
    await me.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove contact error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
