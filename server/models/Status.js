// server/models/Status.js

import mongoose from 'mongoose';

const statusSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['text', 'image'],
    default: 'text'
  },
  text: {
    type: String,
    default: ''
  },
  bg: {
    type: String,
    default: 'default'
  },
  file: {
    type: String,
    default: ''
  },
  viewers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // WhatsApp-style: statuses disappear after 24 hours
  expireAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    index: { expires: 0 }
  }
}, {
  timestamps: true
});

export default mongoose.model('Status', statusSchema);