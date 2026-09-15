// server/routes/profileRoutes.js
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import User from '../models/User.js';
import Group from '../models/Group.js';
import Message from '../models/Message.js';

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
      const me = await User.findById(req.userId).select('name email photo about lastSeen blockedUsers');
      if (!me) return res.status(404).json({ message: 'User not found' });
      res.json({
        user: {
          id: String(me._id),
          name: me.name,
          email: me.email,
          photo: me.photo || DEFAULT_PHOTO,
          about: me.about || '',
          lastSeen: me.lastSeen,
          blockedUsers: (me.blockedUsers || []).map((id) => String(id)),
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
      if (clean.length > 25) return res.status(400).json({ message: 'Name must be 25 characters or fewer' });
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
      // Targets = everyone who needs to know about this rename:
      //   - the user themself
      //   - users the renamed user saved (their chat rows show this profile name)
      //   - users who SAVED the renamed user (their saved-contact rows show this name)
      //     -> without this, a viewer who saved E but hired no custom name never updates.
      const groups = await Group.find({ members: req.userId }).select('members');
      const targets = new Set([String(me._id)]);
      (me.contacts || []).forEach((c) => targets.add(String(c)));
      const savers = await User.find({ contacts: req.userId }).select('_id');
      savers.forEach((s) => targets.add(String(s._id)));
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
      const target = await User.findById(targetId).select('name email photo about lastSeen blockedUsers');
      if (!target) return res.status(404).json({ message: 'User not found' });

      const viewerBlocked = (target.blockedUsers || []).some(
        (id) => String(id) === String(req.userId)
      );

      // Last seen disappears in BOTH directions of a block (WhatsApp-style):
      // neither the blocker nor the blocked user can see the other's activity.
      let viewerBlockedTarget = false;
      let isOwn = false;
      let isContact = false;
      if (String(targetId) === String(req.userId)) {
        isOwn = true;
      } else {
        const me = await User.findById(req.userId).select('contacts blockedUsers');
        isContact = (me?.contacts || []).some((c) => String(c) === String(targetId));
        viewerBlockedTarget = (me?.blockedUsers || []).some((id) => String(id) === String(targetId));
      }
      const blockEitherWay = viewerBlocked || viewerBlockedTarget;

      const body = {
        id: String(target._id),
        name: target.name,
        photo: viewerBlocked ? '' : (target.photo || DEFAULT_PHOTO),
      };
      if (isOwn || isContact) {
        body.about = viewerBlocked ? '' : (target.about || '');
        body.email = viewerBlocked ? '' : target.email;
        body.lastSeen = blockEitherWay ? null : target.lastSeen;
      }
      res.json({ user: body });
    } catch (err) {
      console.error('Get user profile error:', err.message);
      res.status(500).json({ message: 'Server error' });
    }
  });

  function setBlock(req, res, blocked) {
    const targetId = req.params?.id;
    if (!targetId) return res.status(400).json({ message: 'id required' });
    if (String(targetId) === String(req.userId)) {
      return res.status(400).json({ message: "You can't block yourself" });
    }
    (async () => {
      try {
        const updater = blocked
          ? { $addToSet: { blockedUsers: targetId } }
          : { $pull: { blockedUsers: targetId } };
        const me = await User.findByIdAndUpdate(req.userId, updater, { new: true }).select('blockedUsers');
        if (!me) return res.status(404).json({ message: 'User not found' });
        // Tell the target (and my own other devices) that the block changed.
        // `by` = who acted, `target` = who is blocked/unblocked; clients use
        // this to decide whether THEY were blocked or did the blocking.
        emitToUsers([targetId, req.userId], 'user:blocked', {
          by: String(req.userId),
          target: String(targetId),
          blocked,
        });

        // 🔓 On UNBLOCK, deliver every message the now-unblocked user sent
        //    while the block was active. The recipient finally sees them and
        //    the sender's single ticks advance to delivered.
        if (!blocked) {
          try {
            const senderDoc = await User.findById(targetId).select('name');
            const pending = await Message.find({ from: targetId, to: req.userId, delivered: false });
            if (pending.length) {
              console.log(`📦 Delivering ${pending.length} queued messages after unblock: ${targetId} -> ${req.userId}`);
            }
            for (const msg of pending) {
              msg.delivered = true;
              await msg.save();
              emitToUsers([req.userId], 'receiveMessage', {
                _id: String(msg._id),
                to: String(req.userId),
                from: String(targetId),
                fromName: (senderDoc && senderDoc.name) || 'Unknown',
                message: msg.message,
                file: msg.file,
                fileName: msg.fileName,
                fileType: msg.fileType,
                duration: msg.duration,
                replyTo: msg.replyTo ? {
                  sender: msg.replyTo.sender,
                  text: msg.replyTo.text,
                  messageId: msg.replyTo.messageId,
                  statusId: msg.replyTo.statusId,
                  senderId: msg.replyTo.senderId,
                } : null,
                timestamp: new Date(msg.createdAt).getTime(),
                messageId: msg.clientMessageId,
                isForwarded: !!msg.isForwarded,
              });
              emitToUsers([targetId], 'messageDelivered', {
                chatId: String(req.userId),
                messageId: msg.clientMessageId,
                _id: String(msg._id),
              });
            }
          } catch (err) {
            console.error('Deliver queued messages after unblock error:', err.message);
          }
        }

        res.json({ user: { id: String(me._id), blockedUsers: (me.blockedUsers || []).map((id) => String(id)) } });
      } catch (err) {
        console.error('Block user error:', err.message);
        res.status(500).json({ message: 'Server error' });
      }
    })();
  }

  // POST /api/profile/:id/block — block a user
  router.post('/:id/block', auth, (req, res) => setBlock(req, res, true));

  // DELETE /api/profile/:id/block — unblock a user
  router.delete('/:id/block', auth, (req, res) => setBlock(req, res, false));

  return router;
}