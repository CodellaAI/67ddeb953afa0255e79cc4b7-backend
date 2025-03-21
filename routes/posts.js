
const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Community = require('../models/Community');
const Vote = require('../models/Vote');
const User = require('../models/User');
const { protect, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/posts
// @desc    Get all posts or filter by community/author
// @access  Public
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { community, author, sort = 'hot', page = 1, limit = 10 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query
    const query = {};
    
    if (community) {
      query.community = community;
    }
    
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
      case 'new':
        sortOptions = { createdAt: -1 };
        break;
      case 'top':
        sortOptions = { upvotes: -1 };
        break;
      case 'controversial':
        sortOptions = { commentCount: -1 };
        break;
      case 'hot':
      default:
        // Hot is a combination of recency and votes
        sortOptions = { 
          _score: { $meta: "textScore" },
          createdAt: -1 
        };
        break;
    }
    
    // Get posts
    const posts = await Post.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('author', 'username avatar karma')
      .lean();
    
    // If user is authenticated, add their vote status
    if (req.user) {
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
    console.error('Get posts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/posts/:id
// @desc    Get a post by ID
// @access  Public
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'username avatar karma')
      .lean();
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    // If user is authenticated, add their vote status
    if (req.user) {
      const vote = await Vote.findOne({
        user: req.user._id,
        targetType: 'Post',
        target: post._id
      });
      
      post.userVote = vote ? vote.value : 0;
    }
    
    res.json(post);
  } catch (error) {
    console.error('Get post error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/posts
// @desc    Create a new post
// @access  Private
router.post(
  '/',
  [
    protect,
    [
      body('title').not().isEmpty().withMessage('Title is required').trim(),
      body('community').not().isEmpty().withMessage('Community is required').trim(),
      body('postType').isIn(['text', 'image', 'link', 'poll']).withMessage('Invalid post type')
    ]
  ],
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    try {
      const { title, content, image, community, postType } = req.body;
      
      // Check if community exists
      const communityDoc = await Community.findOne({ name: community });
      
      if (!communityDoc) {
        return res.status(404).json({ message: 'Community not found' });
      }
      
      // Create new post
      const newPost = new Post({
        title,
        content,
        image,
        author: req.user._id,
        community,
        postType: postType || 'text'
      });
      
      await newPost.save();
      
      // Populate author for response
      const post = await Post.findById(newPost._id)
        .populate('author', 'username avatar karma');
      
      res.status(201).json(post);
    } catch (error) {
      console.error('Create post error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// @route   PUT /api/posts/:id
// @desc    Update a post
// @access  Private
router.put(
  '/:id',
  [
    protect,
    [
      body('title').optional().trim(),
      body('content').optional().trim()
    ]
  ],
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    try {
      const post = await Post.findById(req.params.id);
      
      if (!post) {
        return res.status(404).json({ message: 'Post not found' });
      }
      
      // Check if user is the author
      if (post.author.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Not authorized to update this post' });
      }
      
      // Update fields
      const { title, content } = req.body;
      
      if (title) post.title = title;
      if (content !== undefined) post.content = content;
      
      await post.save();
      
      res.json(post);
    } catch (error) {
      console.error('Update post error:', error);
      
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Post not found' });
      }
      
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// @route   DELETE /api/posts/:id
// @desc    Delete a post
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    // Check if user is the author
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this post' });
    }
    
    // Delete post and its comments
    await Promise.all([
      post.deleteOne(),
      Comment.deleteMany({ post: post._id }),
      Vote.deleteMany({ targetType: 'Post', target: post._id })
    ]);
    
    res.json({ message: 'Post removed' });
  } catch (error) {
    console.error('Delete post error:', error);
    
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/posts/:id/vote
// @desc    Vote on a post
// @access  Private
router.post('/:id/vote', protect, async (req, res) => {
  try {
    const { value } = req.body;
    const postId = req.params.id;
    
    // Validate vote value
    if (![1, 0, -1].includes(Number(value))) {
      return res.status(400).json({ message: 'Invalid vote value' });
    }
    
    const post = await Post.findById(postId);
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    // Start a session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Get existing vote
      let vote = await Vote.findOne({
        user: req.user._id,
        targetType: 'Post',
        target: postId
      }).session(session);
      
      const previousValue = vote ? vote.value : 0;
      
      if (value === 0) {
        // Remove vote
        if (vote) {
          await vote.deleteOne({ session });
          
          // Update post vote counts
          if (previousValue === 1) {
            post.upvotes = Math.max(0, post.upvotes - 1);
          } else if (previousValue === -1) {
            post.downvotes = Math.max(0, post.downvotes - 1);
          }
        }
      } else {
        if (vote) {
          // Update existing vote
          vote.value = value;
          await vote.save({ session });
          
          // Update post vote counts
          if (previousValue === 1 && value === -1) {
            post.upvotes = Math.max(0, post.upvotes - 1);
            post.downvotes += 1;
          } else if (previousValue === -1 && value === 1) {
            post.downvotes = Math.max(0, post.downvotes - 1);
            post.upvotes += 1;
          }
        } else {
          // Create new vote
          vote = new Vote({
            user: req.user._id,
            targetType: 'Post',
            target: postId,
            value
          });
          
          await vote.save({ session });
          
          // Update post vote counts
          if (value === 1) {
            post.upvotes += 1;
          } else if (value === -1) {
            post.downvotes += 1;
          }
        }
      }
      
      // Save post
      await post.save({ session });
      
      // Update author's karma
      const author = await User.findById(post.author);
      if (author) {
        await author.updateKarma();
      }
      
      // Commit transaction
      await session.commitTransaction();
      session.endSession();
      
      res.json({ message: 'Vote recorded', post });
    } catch (error) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    console.error('Vote post error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/posts/:id/comments
// @desc    Get comments for a post
// @access  Public
router.get('/:id/comments', optionalAuth, async (req, res) => {
  try {
    const { sort = 'best' } = req.query;
    
    // Determine sort order
    let sortOptions = {};
    switch (sort) {
      case 'new':
        sortOptions = { createdAt: -1 };
        break;
      case 'old':
        sortOptions = { createdAt: 1 };
        break;
      case 'controversial':
        sortOptions = { downvotes: -1 };
        break;
      case 'best':
      default:
        sortOptions = { upvotes: -1, createdAt: -1 };
        break;
    }
    
    // Get top-level comments
    const comments = await Comment.find({
      post: req.params.id,
      parentId: null
    })
      .sort(sortOptions)
      .populate('author', 'username avatar karma')
      .lean();
    
    // Get all replies for these comments
    const commentIds = comments.map(comment => comment._id);
    const replies = await Comment.find({
      post: req.params.id,
      parentId: { $in: commentIds }
    })
      .populate('author', 'username avatar karma')
      .lean();
    
    // Create a map of parent comment to replies
    const replyMap = {};
    replies.forEach(reply => {
      const parentId = reply.parentId.toString();
      if (!replyMap[parentId]) {
        replyMap[parentId] = [];
      }
      replyMap[parentId].push(reply);
    });
    
    // Add replies to each comment
    comments.forEach(comment => {
      comment.replies = replyMap[comment._id.toString()] || [];
    });
    
    // If user is authenticated, add their vote status
    if (req.user) {
      // Get all comment IDs (including replies)
      const allCommentIds = [
        ...comments.map(c => c._id),
        ...replies.map(r => r._id)
      ];
      
      const userVotes = await Vote.find({
        user: req.user._id,
        targetType: 'Comment',
        target: { $in: allCommentIds }
      });
      
      const voteMap = {};
      userVotes.forEach(vote => {
        voteMap[vote.target.toString()] = vote.value;
      });
      
      // Add user vote to comments
      comments.forEach(comment => {
        comment.userVote = voteMap[comment._id.toString()] || 0;
        
        // Add user vote to replies
        (comment.replies || []).forEach(reply => {
          reply.userVote = voteMap[reply._id.toString()] || 0;
        });
      });
    }
    
    res.json(comments);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/posts/:id/comments
// @desc    Add a comment to a post
// @access  Private
router.post(
  '/:id/comments',
  [
    protect,
    [
      body('content').not().isEmpty().withMessage('Comment content is required').trim()
    ]
  ],
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    try {
      const post = await Post.findById(req.params.id);
      
      if (!post) {
        return res.status(404).json({ message: 'Post not found' });
      }
      
      const { content, parentId } = req.body;
      
      // If this is a reply, verify parent comment exists
      if (parentId) {
        const parentComment = await Comment.findById(parentId);
        
        if (!parentComment) {
          return res.status(404).json({ message: 'Parent comment not found' });
        }
        
        if (parentComment.post.toString() !== req.params.id) {
          return res.status(400).json({ message: 'Parent comment does not belong to this post' });
        }
      }
      
      // Create comment
      const newComment = new Comment({
        content,
        author: req.user._id,
        post: req.params.id,
        parentId: parentId || null
      });
      
      await newComment.save();
      
      // Increment post comment count
      post.commentCount += 1;
      await post.save();
      
      // Populate author for response
      const comment = await Comment.findById(newComment._id)
        .populate('author', 'username avatar karma');
      
      res.status(201).json(comment);
    } catch (error) {
      console.error('Create comment error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

module.exports = router;
