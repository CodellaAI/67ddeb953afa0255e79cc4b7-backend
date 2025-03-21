
const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const Community = require('../models/Community');
const Post = require('../models/Post');
const User = require('../models/User');
const { protect, moderator, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/communities
// @desc    Get all communities
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { search, sort = 'name', page = 1, limit = 20 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    let query = {};
    
    if (search) {
      query = { $text: { $search: search } };
    }
    
    // Determine sort order
    let sortOptions = {};
    switch (sort) {
      case 'members':
        sortOptions = { memberCount: -1 };
        break;
      case 'new':
        sortOptions = { createdAt: -1 };
        break;
      case 'name':
      default:
        sortOptions = { name: 1 };
        break;
    }
    
    // Get communities
    const communities = await Community.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('creator', 'username')
      .lean();
    
    res.json(communities);
  } catch (error) {
    console.error('Get communities error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/communities/popular
// @desc    Get popular communities
// @access  Public
router.get('/popular', async (req, res) => {
  try {
    const communities = await Community.find()
      .sort({ memberCount: -1 })
      .limit(5)
      .lean();
    
    res.json(communities);
  } catch (error) {
    console.error('Get popular communities error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/communities/:name
// @desc    Get a community by name
// @access  Public
router.get('/:name', optionalAuth, async (req, res) => {
  try {
    const community = await Community.findOne({ name: req.params.name })
      .populate('creator', 'username')
      .populate('moderators', 'username')
      .lean();
    
    if (!community) {
      return res.status(404).json({ message: 'Community not found' });
    }
    
    // If user is authenticated, check if they've joined
    if (req.user) {
      community.isJoined = req.user.joinedCommunities.includes(community.name);
    } else {
      community.isJoined = false;
    }
    
    res.json(community);
  } catch (error) {
    console.error('Get community error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/communities
// @desc    Create a new community
// @access  Private
router.post(
  '/',
  [
    protect,
    [
      body('name')
        .isLength({ min: 3, max: 21 })
        .withMessage('Community name must be between 3 and 21 characters')
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Community name can only contain letters, numbers and underscores')
        .trim(),
      body('description')
        .isLength({ min: 1, max: 500 })
        .withMessage('Description must be between 1 and 500 characters')
        .trim()
    ]
  ],
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    try {
      const { name, description, type = 'public' } = req.body;
      
      // Check if community already exists
      const existingCommunity = await Community.findOne({ name });
      
      if (existingCommunity) {
        return res.status(400).json({ message: 'Community already exists' });
      }
      
      // Create new community
      const newCommunity = new Community({
        name,
        description,
        creator: req.user._id,
        moderators: [req.user._id],
        type
      });
      
      // Start a session for transaction
      const session = await mongoose.startSession();
      session.startTransaction();
      
      try {
        // Save community
        await newCommunity.save({ session });
        
        // Add community to user's joined communities
        await User.findByIdAndUpdate(
          req.user._id,
          { $addToSet: { joinedCommunities: name } },
          { session }
        );
        
        // Commit transaction
        await session.commitTransaction();
        session.endSession();
        
        res.status(201).json(newCommunity);
      } catch (error) {
        // Abort transaction on error
        await session.abortTransaction();
        session.endSession();
        throw error;
      }
    } catch (error) {
      console.error('Create community error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// @route   PUT /api/communities/:name
// @desc    Update a community
// @access  Private (moderator only)
router.put(
  '/:name',
  [
    protect,
    moderator,
    [
      body('description')
        .optional()
        .isLength({ max: 500 })
        .withMessage('Description cannot exceed 500 characters')
        .trim()
    ]
  ],
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    try {
      const { description, rules, type } = req.body;
      const community = req.community; // Attached by moderator middleware
      
      // Update fields
      if (description) community.description = description;
      if (rules) community.rules = rules;
      if (type) community.type = type;
      
      await community.save();
      
      res.json(community);
    } catch (error) {
      console.error('Update community error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// @route   POST /api/communities/:name/join
// @desc    Join a community
// @access  Private
router.post('/:name/join', protect, async (req, res) => {
  try {
    const communityName = req.params.name;
    
    // Check if community exists
    const community = await Community.findOne({ name: communityName });
    
    if (!community) {
      return res.status(404).json({ message: 'Community not found' });
    }
    
    // Check if user has already joined
    if (req.user.joinedCommunities.includes(communityName)) {
      return res.status(400).json({ message: 'Already a member of this community' });
    }
    
    // Start a session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Add community to user's joined communities
      await User.findByIdAndUpdate(
        req.user._id,
        { $addToSet: { joinedCommunities: communityName } },
        { session }
      );
      
      // Increment community member count
      community.memberCount += 1;
      await community.save({ session });
      
      // Commit transaction
      await session.commitTransaction();
      session.endSession();
      
      res.json({ message: 'Joined community successfully' });
    } catch (error) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    console.error('Join community error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/communities/:name/leave
// @desc    Leave a community
// @access  Private
router.post('/:name/leave', protect, async (req, res) => {
  try {
    const communityName = req.params.name;
    
    // Check if community exists
    const community = await Community.findOne({ name: communityName });
    
    if (!community) {
      return res.status(404).json({ message: 'Community not found' });
    }
    
    // Check if user is a member
    if (!req.user.joinedCommunities.includes(communityName)) {
      return res.status(400).json({ message: 'Not a member of this community' });
    }
    
    // Check if user is the creator
    if (community.creator.equals(req.user._id)) {
      return res.status(400).json({ message: 'Creator cannot leave the community' });
    }
    
    // Start a session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Remove community from user's joined communities
      await User.findByIdAndUpdate(
        req.user._id,
        { $pull: { joinedCommunities: communityName } },
        { session }
      );
      
      // Decrement community member count
      community.memberCount = Math.max(1, community.memberCount - 1);
      
      // If user is a moderator, remove from moderators list
      if (community.moderators.some(mod => mod.equals(req.user._id))) {
        community.moderators = community.moderators.filter(
          mod => !mod.equals(req.user._id)
        );
      }
      
      await community.save({ session });
      
      // Commit transaction
      await session.commitTransaction();
      session.endSession();
      
      res.json({ message: 'Left community successfully' });
    } catch (error) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    console.error('Leave community error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
