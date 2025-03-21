
const mongoose = require('mongoose');

const communitySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 21,
    match: /^[a-zA-Z0-9_]+$/
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  moderators: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  memberCount: {
    type: Number,
    default: 1 // Creator starts as a member
  },
  type: {
    type: String,
    enum: ['public', 'restricted', 'private'],
    default: 'public'
  },
  rules: [{
    title: String,
    description: String
  }],
  banner: {
    type: String,
    default: ''
  },
  icon: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

communitySchema.index({ name: 'text', description: 'text' });

const Community = mongoose.model('Community', communitySchema);

module.exports = Community;
