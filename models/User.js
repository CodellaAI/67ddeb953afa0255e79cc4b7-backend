
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  avatar: {
    type: String,
    default: ''
  },
  bio: {
    type: String,
    default: '',
    maxlength: 500
  },
  karma: {
    type: Number,
    default: 0
  },
  joinedCommunities: [{
    type: String,
    ref: 'Community'
  }],
  isAdmin: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to update karma
userSchema.methods.updateKarma = async function() {
  const Post = mongoose.model('Post');
  const Comment = mongoose.model('Comment');
  
  const [postKarma, commentKarma] = await Promise.all([
    // Calculate post karma
    Post.aggregate([
      { $match: { author: this._id } },
      { $project: { karma: { $subtract: ['$upvotes', '$downvotes'] } } },
      { $group: { _id: null, total: { $sum: '$karma' } } }
    ]),
    
    // Calculate comment karma
    Comment.aggregate([
      { $match: { author: this._id } },
      { $project: { karma: { $subtract: ['$upvotes', '$downvotes'] } } },
      { $group: { _id: null, total: { $sum: '$karma' } } }
    ])
  ]);
  
  // Update user's karma
  this.karma = 
    (postKarma.length > 0 ? postKarma[0].total : 0) + 
    (commentKarma.length > 0 ? commentKarma[0].total : 0);
  
  await this.save();
  return this.karma;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
