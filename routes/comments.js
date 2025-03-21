
const express = require('express');
const mongoose = require('mongoose');
const Comment = require('../models/Comment');
const Vote = require('../models/Vote');
const User = require('../models/User');
const { protect, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/comments
// @desc    Get comments by author
// @access  Public
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { author, sort = 'new', page = 1, limit = 20 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    const query = {};
    
    if (author) {
      const authorUser = await User.findOne({ username: author });
      if (authorUser) {
        query.author = authorUser._id;
      } else {
        return res.json([]);
      }
    }
    
    // Determine sort order
    let sortOptions = {};
    switch (sort) {
      case 'old':
        sortOptions = { createdAt: 1 };
        break;
      case 'top':
        sortOptions = { upvotes: -1 };
        break;
      case 'controversial':
        sortOptions = { downvotes: -1 };
        break;
      case 'new':
      default:
        sortOptions = { createdAt: -1 };
        break;
    }
    
    // Get comments
    const comments = await Comment.find(query)
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
    console.error('Get comments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/comments/:id
// @desc    Update a comment
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Comment content is required' });
    }
    
    const comment = await Comment.findById(req.params.id);
    
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }
    
    // Check if user is the author
    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this comment' });
    }
    
    // Update comment
    comment.content = content.trim();
    await comment.save();
    
    res.json(comment);
  } catch (error) {
    console.error('Update comment error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ message: 'Comment not found' });
    }
    
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/comments/:id
// @desc    Delete a comment
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }
    
    // Check if user is the author
    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this comment' });
    }
    
    // Delete comment and its votes
    await Promise.all([
      comment.deleteOne(),
      Vote.deleteMany({ targetType: 'Comment', target: comment._id })
    ]);
    
    res.json({ message: 'Comment removed' });
  } catch (error) {
    console.error('Delete comment error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ message: 'Comment not found' });
    }
    
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/comments/:id/vote
// @desc    Vote on a comment
// @access  Private
router.post('/:id/vote', protect, async (req, res) => {
  try {
    const { value } = req.body;
    const commentId = req.params.id;
    
    // Validate vote value
    if (![1, 0, -1].includes(Number(value))) {
      return res.status(400).json({ message: 'Invalid vote value' });
    }
    
    const comment = await Comment.findById(commentId);
    
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }
    
    // Start a session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Get existing vote
      let vote = await Vote.findOne({
        user: req.user._id,
        targetType: 'Comment',
        target: commentId
      }).session(session);
      
      const previousValue = vote ? vote.value : 0;
      
      if (value === 0) {
        // Remove vote
        if (vote) {
          await vote.deleteOne({ session });
          
          // Update comment vote counts
          if (previousValue === 1) {
            comment.upvotes = Math.max(0, comment.upvotes - 1);
          } else if (previousValue === -1) {
            comment.downvotes = Math.max(0, comment.downvotes - 1);
          }
        }
      } else {
        if (vote) {
          // Update existing vote
          vote.value = value;
          await vote.save({ session });
          
          // Update comment vote counts
          if (previousValue === 1 && value === -1) {
            comment.upvotes = Math.max(0, comment.upvotes - 1);
            comment.downvotes += 1;
          } else if (previousValue === -1 && value === 1) {
            comment.downvotes = Math.max(0, comment.downvotes - 1);
            comment.upvotes += 1;
          }
        } else {
          // Create new vote
          vote = new Vote({
            user: req.user._id,
            targetType: 'Comment',
            target: commentId,
            value
          });
          
          await vote.save({ session });
          
          // Update comment vote counts
          if (value === 1) {
            comment.upvotes += 1;
          } else if (value === -1) {
            comment.downvotes += 1;
          }
        }
      }
      
      // Save comment
      await comment.save({ session });
      
      // Update author's karma
      const author = await User.findById(comment.author);
      if (author) {
        await author.updateKarma();
      }
      
      // Commit transaction
      await session.commitTransaction();
      session.endSession();
      
      res.json({ message: 'Vote recorded', comment });
    } catch (error) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    console.error('Vote comment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
