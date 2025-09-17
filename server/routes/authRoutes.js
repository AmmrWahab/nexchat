// server/routes/authRoutes.js

import { Router } from 'express';
import { register, login, googleLogin } from '../controllers/authController.js';
import User from '../models/User.js'; // ← Critical!

const router = Router();

// POST /api/auth/register
router.post('/auth/register', register);

// POST /api/auth/login
router.post('/auth/login', login);

// POST /api/auth/google
router.post('/auth/google', googleLogin);



// GET /api/auth/check-email?email=user@example.com
router.get('/auth/check-email', async (req, res) => {
  const { email } = req.query;

  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    return res.status(400).json({ message: 'Valid email required' });
  }

  try {
    const user = await User.findOne({ email }).select('name email photo');
    if (user) {
      res.json({ user });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;