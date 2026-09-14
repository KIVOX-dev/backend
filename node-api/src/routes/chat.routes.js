const express = require('express');
const controller = require('../controllers/chat.controller');
const authenticate = require('../middlewares/authenticate');

const router = express.Router();
router.use(authenticate);

// Registered before /history/:otherUserId so "threads" is never captured by
// that route's :otherUserId param.
router.get('/threads', controller.threads);
router.get('/history/:otherUserId', controller.history);

module.exports = router;
