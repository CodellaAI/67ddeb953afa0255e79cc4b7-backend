
const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const { protect, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/users/:username
// @desc    Get user by username
// @access  Public
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('-password -email')
      .lean();
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put(
  '/profile',
  [
    protect,
    [
      body('bio')
        .optional()
        .isLength({ max: 500 })
        .withMessage('Bio cannot exceed 500 characters')
        .trim(),
      body('avatar')
        .optional()
        .isURL()
        .withMessage('Avatar must be a valid URL')
    ]
  ],
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    try {
      const { bio, avatar } = req.body;
      
      // Update user
      const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        {
          $set: {
            bio: bio || req.user.bio,
            avatar: avatar || req.user.avatar
          }
        },
        { new: true }
      ).select('-password');
      
      res.json(updatedUser);
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// @route   GET /api/users/:username/posts
// @desc    Get posts by username
// @access  Public
router.get('/:username/posts', optionalAuth, async (req, res) => {
  try {
    const { sort = 'new', page = 1, limit = 10 } = req.query;
    
    // Find user
    const user = await User.findOne({ username: req.params.username });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Determine sort order
    let sortOptions = {};
    switch (sort) {
      case 'top':
        sortOptions = { upvotes: -1 };
        break;
      case 'controversial':
        sortOptions = { commentCount: -1 };
        break;
      case 'new':
      default:
        sortOptions = { createdAt: -1 };
        break;
    }
    
    // Get posts
    const posts = await Post.find({ author: user._id })
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('author', 'username avatar karma')
      .lean();
    
    // If user is authenticated, add their vote status
    if (req.user) {
      const Vote = require('../models/Vote');
      
      const userVotes = await Vote.find({
        user: req.user._id,
        targetType: 'Post',
        target: { $in: posts.map(post => post._id) }
      });
      
      const voteMap = {};
      userVotes.forEach(vote => {
        voteMap[vote.target.toString()] = vote.value;
      });
      
      posts.forEach(post => {
        post.userVote = voteMap[post._id.toString()] || 0;
      });
    }
    
    res.json(posts);
  } catch (error) {
    console.error('Get user posts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/users/:username/comments
// @desc    Get comments by username
// @access  Public
router.get('/:username/comments', optionalAuth, async (req, res) => {
  try {
    const { sort = 'new', page = 1, limit = 20 } = req.query;
    
    // Find user
    const user = await User.findOne({ username: req.params.username });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Determine sort order
    let sortOptions = {};
    switch (sort) {
      case 'top':
        sortOptions = { upvotes: -1 };
        break;
      case 'controversial':
        sortOptions = { downvotes: -1 };
        break;
      case 'old':
        sortOptions = { createdAt: 1 };
        break;
      case 'new':
      default:
        sortOptions = { createdAt: -1 };
        break;
    }
    
    // Get comments
    const comments = await Comment.find({ author: user._id })
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('author', 'username avatar karma')
      .populate({
        path: 'post',
        select: 'title community'
      })
      .lean();
    
    // If user is authenticated, add their vote status
    if (req.user) {
      const Vote = require('../models/Vote');
      
      const userVotes = await Vote.find({
        user: req.user._id,
        targetType: 'Comment',
        target: { $in: comments.map(comment => comment._id) }
      });
      
      const voteMap = {};
      userVotes.forEach(vote => {
        voteMap[vote.target.toString()] = vote.value;
      });
      
      comments.forEach(comment => {
        comment.userVote = voteMap[comment._id.toString()] || 0;
      });
    }
    
    res.json(comments);
  } catch (error) {
    console.error('Get user comments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
