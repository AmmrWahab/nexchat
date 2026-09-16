// server/models/Report.js
// A user report filed against another user. Structured so an admin panel can
// list, filter and review reports later (createAt + indexed reported user).

import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true, // admin: "reports filed by this user"
  },
  reported: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true, // admin: primary lookup "reports against this user"
  },
  reason: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000,
  },
  status: {
    type: String,
    enum: ['pending', 'resolved', 'dismissed'],
    default: 'pending', // admin: review workflow
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true, // admin: chronological review
  },
});

// Most common admin query: all reports about a user, newest first.
reportSchema.index({ reported: 1, createdAt: -1 });

export default mongoose.model('Report', reportSchema);