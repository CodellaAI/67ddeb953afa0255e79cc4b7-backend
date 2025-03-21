
const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  targetType: {
    type: String,
    enum: ['Post', 'Comment'],
    required: true
  },
  target: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'targetType'
  },
  value: {
    type: Number,
    enum: [-1, 0, 1],
    required: true
  }
}, {
  timestamps: true
});

// Create a compound index to ensure one vote per user per target
voteSchema.index({ user: 1, targetType: 1, target: 1 }, { unique: true });

const Vote = mongoose.model('Vote', voteSchema);

module.exports = Vote;
