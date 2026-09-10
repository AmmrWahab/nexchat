// server/models/User.js

import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: function() { return !this.googleId; }, // Only required if not Google login
    minlength: 6
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true, // Allows nulls
    select: false // Never return in queries
  },
  photo: {
    type: String,
    default: 'https://via.placeholder.com/150'
  },
  contacts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
    lastSeen: { type: Date, default: Date.now }, // ← Add this
}, {
  timestamps: true
});

export default mongoose.model('User', userSchema);