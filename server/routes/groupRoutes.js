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
  const { name, dp, members, addMembers, sendMessages } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Group name required' });
  const memberIds = Array.isArray(members) && members.length ? members : [];
  const groupAddMembers = addMembers === 'admins' ? 'admins' : 'everyone';
  const groupSendMessages = sendMessages === 'admins' ? 'admins' : 'everyone';

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
      members: finalMembers,
      addMembers: groupAddMembers,
      sendMessages: groupSendMessages,
    });

    const populated = await Group.findById(group._id)
      .populate('admin', 'name photo about')
      .populate('members', 'name photo about');

    res.status(201).json({ group: populated });
  } catch (err) {
    console.error('Create group error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/groups — return all groups the current user is a member of (or was
// a member of before being removed, so they can still open the group and read
// the history). Removed groups are marked with removedAt/removedBy.
router.get('/groups', auth, async (req, res) => {
  try {
    const groups = await Group.find({
      $or: [{ members: req.userId }, { 'removedMembers.user': req.userId }],
    })
.populate('admin', 'name photo about')
      .populate('members', 'name photo about email')
      .sort({ createdAt: -1 });

    // Attach the last message + time of each group so the list preview
    // updates immediately on refresh without depending on socket timing.
    // For a removed member the preview stops at the moment they were removed.
    // Computed with ONE aggregation across all groups instead of a
    // findOne+populate round-trip per group (previously N+1 DB queries that
    // made the group list slow to appear after a page refresh).
    const bounds = groups.map((group) => {
      const removedInfo = (group.removedMembers || []).find((r) => String(r.user) === String(req.userId));
      const bound = removedInfo ? { createdAt: { $lte: removedInfo.removedAt } } : {};
      return { removedInfo, bound };
    });

    const orFilters = groups.map((group, i) => ({
      group: group._id,
      ...bounds[i].bound,
    }));

    const lastById = new Map();
    if (orFilters.length) {
      const latest = await GroupMessage.aggregate([
        { $match: { $or: orFilters } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$group', doc: { $first: '$$ROOT' } } },
      ]).exec();
      const ids = latest.map((r) => r.doc._id);
      if (ids.length) {
        const populated = await GroupMessage.find({ _id: { $in: ids } })
          .populate('from', 'name photo')
          .populate('target', 'name photo')
          .exec();
        populated.forEach((m) => lastById.set(String(m._id), m));
      }
    }

    const withLast = groups.map((group, i) => {
      const { removedInfo } = bounds[i];
      const g = group.toObject();
      g.admins = (g.admins || []).map(String);
      g.addMembers = g.addMembers || 'everyone';
      g.sendMessages = g.sendMessages || 'everyone';
      if (removedInfo) {
        g.removedAt = removedInfo.removedAt;
        g.removedBy = String(removedInfo.removedBy?._id || removedInfo.removedBy || '');
      } else {
        delete g.removedAt;
        delete g.removedBy;
      }
      delete g.removedMembers;
      const last = lastById.get(String(group._id)) || null;
      if (last) {
        g.lastMessage = {
          text: last.message,
          file: last.file,
          fileName: last.fileName,
          fileType: last.fileType,
          from: String(last.from?._id || last.from),
          fromName: last.from?.name || 'Someone',
          fromPhoto: last.from?.photo,
          isSystem: !!last.isSystem,
          systemType: last.systemType || null,
          target: last.target ? String(last.target._id || last.target) : null,
          targetName: last.target?.name || last.targetName || '',
          timestamp: new Date(last.createdAt).getTime(),
        };
      }
      return g;
    });

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

// Custom saved name for a user in the current user's address book, if any.
// The account owner's real `name` is NEVER overwritten — the custom name is
// stored per-viewer in `me.contactNames` and used only for display.
function customNameFor(me, userId) {
  const hit = (me?.contactNames || []).find((n) => n && String(n.user) === String(userId));
  return hit && hit.name && String(hit.name).trim() ? String(hit.name).trim() : null;
}

// GET /api/contacts — return the current user's private address book
// Each contact's `name` is the effective display name: the viewer's custom
// saved name when present, otherwise the target user's real account name.
router.get('/contacts', auth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).populate('contacts', 'name email photo about lastSeen blockedUsers');
    const myBlocked = new Set((me?.blockedUsers || []).map((id) => String(id)));
    const contacts = (me?.contacts || []).map((c) => {
      const customName = customNameFor(me, c._id);
      const blockedByMe = myBlocked.has(String(c._id));
      const blockedMe = (c.blockedUsers || []).some((id) => String(id) === String(req.userId));
      return {
        _id: String(c._id),
        name: customName || c.name || 'Unknown',
        customName,
        email: c.email,
        photo: blockedMe ? '' : (c.photo || 'https://via.placeholder.com/50'),
        about: blockedMe ? '' : (c.about || ''),
        lastSeen: (blockedByMe || blockedMe) ? null : c.lastSeen,
        blockedByMe,
        blockedMe,
      };
    });
    res.json({ contacts });
  } catch (err) {
    console.error('Get contacts error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/contacts — add a user to the current user's address book
// An optional `name` (trimmed) is persisted as the viewer's custom display
// name for that contact. When omitted/blank, the real account name is used.
router.post('/contacts', auth, async (req, res) => {
  const { userId, name } = req.body || {};
  if (!userId) return res.status(400).json({ message: 'userId required' });
  if (String(userId) === String(req.userId)) return res.status(400).json({ message: 'Cannot add yourself' });
  try {
    const target = await User.findById(userId);
    if (!target) return res.status(404).json({ message: 'User not found' });
    const me = await User.findById(req.userId);
    if (!me) return res.status(404).json({ message: 'User not found' });
    const customName = String(name || '').trim() || null;
    if (!me.contacts.some((id) => String(id) === String(userId))) {
      me.contacts.push(userId);
    }
    if (customName) {
      const idx = me.contactNames.findIndex((n) => n && String(n.user) === String(userId));
      if (idx > -1) me.contactNames[idx].name = customName;
      else me.contactNames.push({ user: userId, name: customName });
    } else {
      // Empty name => remove this viewer's own saved custom name (the contact
      // link itself stays) so the real account name is displayed again. Only
      // the current user's per-viewer entry is touched, never another user's.
      me.contactNames = me.contactNames.filter((n) => n && String(n.user) !== String(userId));
    }
    await me.save();
    res.status(201).json({
      contact: {
        id: target._id,
        name: customName || target.name,
        customName,
        email: target.email,
        photo: target.photo,
        lastSeen: target.lastSeen,
      },
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
    me.contactNames = (me.contactNames || []).filter((n) => n && String(n.user) !== String(contactId));
    await me.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove contact error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/groups/:groupId — permanently remove a group from the CURRENT
// viewer's list (and chats). Only allowed after the viewer already exited the
// group (still-active members get 409); the server-side guard mirrors the UI,
// which hides the Delete group button until the group is marked removedAt.
// When nobody references the group anymore (no members, no removedMembers) the
// group + its message history are deleted for everyone; otherwise just this
// viewer's reference is dropped and other members keep the group.
router.delete('/groups/:groupId', auth, async (req, res) => {
  const groupId = req.params?.groupId;
  if (!groupId) return res.status(400).json({ message: 'groupId required' });
  try {
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    const uid = String(req.userId);
    if ((group.members || []).some((m) => String(m) === uid)) {
      return res.status(409).json({ message: 'Exit the group first' });
    }
    if (!(group.removedMembers || []).some((r) => r && String(r.user) === uid)) {
      return res.status(404).json({ message: 'Group not found' });
    }
    group.members = (group.members || []).filter((m) => String(m) !== uid);
    group.admins = (group.admins || []).filter((a) => String(a) !== uid);
    group.removedMembers = (group.removedMembers || []).filter((r) => r && String(r.user) !== uid);
    if (!group.members.length && !group.removedMembers.length) {
      await GroupMessage.deleteMany({ group: group._id });
      await Group.deleteOne({ _id: group._id });
    } else {
      await group.save();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete group error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
