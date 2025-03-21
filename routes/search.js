
const express = require('express');
const Post = require('../models/Post');
const Community = require('../models/Community');
const User = require('../models/User');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/search
// @desc    Search posts, communities and users
// @access  Public
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { q, type = 'all', sort = 'relevance', page = 1, limit = 10 } = req.query;
    
    if (!q) {
      return res.status(400).json({ message: 'Search query is required' });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build search results
    const results = {
      posts: [],
      communities: [],
      users: []
    };
    
    // Determine which types to search
    const searchTypes = type === 'all' 
      ? ['posts', 'communities', 'users'] 
      : [type];
    
    // Perform searches in parallel
    const searchPromises = [];
    
    if (searchTypes.includes('posts')) {
      // Determine sort order for posts
      let sortOptions = {};
      switch (sort) {
        case 'new':
          sortOptions = { createdAt: -1 };
          break;
        case 'top':
          sortOptions = { upvotes: -1 };
          break;
        case 'comments':
          sortOptions = { commentCount: -1 };
          break;
        case 'relevance':
        default:
          sortOptions = { score: { $meta: 'textScore' } };
          break;
      }
      
      const postsPromise = Post.find(
        { $text: { $search: q } },
        { score: { $meta: 'textScore' } }
      )
        .sort(sortOptions)
        .skip(type === 'all' ? 0 : skip)
        .limit(type === 'all' ? 3 : parseInt(limit))
        .populate('author', 'username avatar karma')
        .lean();
        
      searchPromises.push(postsPromise.then(posts => {
        results.posts = posts;
      }));
    }
    
    if (searchTypes.includes('communities')) {
      const communitiesPromise = Community.find(
        { $text: { $search: q } },
        { score: { $meta: 'textScore' } }
      )
        .sort({ score: { $meta: 'textScore' } })
        .skip(type === 'all' ? 0 : skip)
        .limit(type === 'all' ? 3 : parseInt(limit))
        .lean();
        
      searchPromises.push(communitiesPromise.then(communities => {
        results.communities = communities;
      }));
    }
    
    if (searchTypes.includes('users')) {
      const usersPromise = User.find(
        { username: { $regex: q, $options: 'i' } }
      )
        .select('username avatar karma createdAt')
        .sort({ karma: -1 })
        .skip(type === 'all' ? 0 : skip)
        .limit(type === 'all' ? 3 : parseInt(limit))
        .lean();
        
      searchPromises.push(usersPromise.then(users => {
        results.users = users;
      }));
    }
    
    // Wait for all searches to complete
    await Promise.all(searchPromises);
    
    // If user is authenticated, add their vote status to posts
    if (req.user && results.posts.length > 0) {
      const Vote = require('../models/Vote');
      
      const userVotes = await Vote.find({
        user: req.user._id,
        targetType: 'Post',
        target: { $in: results.posts.map(post => post._id) }
      });
      
      const voteMap = {};
      userVotes.forEach(vote => {
        voteMap[vote.target.toString()] = vote.value;
      });
      
      results.posts.forEach(post => {
        post.userVote = voteMap[post._id.toString()] || 0;
      });
    }
    
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
