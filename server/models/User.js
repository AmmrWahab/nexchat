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
  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  contactNames: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    name: {
      type: String,
      trim: true
    }
  }],
  // Per-account "Clear chat (for me)" points. A cleared DM/group stores the
  // timestamp at which THIS user cleared it, so every device of the same
  // account hides history older than the stamp (while messages received after
  // clearing still appear). Messages are NOT deleted from the DB — only the
  // viewer's view of them is reset.
  clearedDms: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    clearedAt: {
      type: Date
    }
  }],
  clearedGroups: [{
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group'
    },
    clearedAt: {
      type: Date
    }
  }],
    lastSeen: { type: Date, default: Date.now }, // ← Add this
  about: {
    type: String,
    trim: true,
    default: ''
  },
}, {
  timestamps: true
});

export default mongoose.model('User', userSchema);