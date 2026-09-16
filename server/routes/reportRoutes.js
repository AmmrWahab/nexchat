// server/routes/reportRoutes.js
// Endpoints for the Report User feature. No admin endpoints yet, but the
// Report model is indexed so an admin panel can later retrieve and review them.

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import User from '../models/User.js';
import Report from '../models/Report.js';

const router = Router();
const verifyAsync = promisify(jwt.verify);

// Simple JWT auth middleware (same pattern as groupRoutes).
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

// POST /api/reports — file a user report (stored for admin review).
router.post('/reports', auth, async (req, res) => {
  const { reportedId, reason } = req.body || {};
  if (!reportedId) return res.status(400).json({ message: 'reportedId required' });
  if (String(reportedId) === String(req.userId)) {
    return res.status(400).json({ message: "You can't report yourself" });
  }
  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  if (!cleanReason) return res.status(400).json({ message: 'Reason is required' });
  if (cleanReason.length > 1000) {
    return res.status(400).json({ message: 'Reason must be 1000 characters or fewer' });
  }
  try {
    const target = await User.findById(reportedId);
    if (!target) return res.status(404).json({ message: 'User not found' });

    const report = await Report.create({
      reporter: req.userId,
      reported: reportedId,
      reason: cleanReason,
    });

    res.status(201).json({
      report: {
        id: String(report._id),
        reporter: String(report.reporter),
        reported: String(report.reported),
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      },
    });
  } catch (err) {
    console.error('Report create error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;