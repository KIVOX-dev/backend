const express = require('express');
const controller = require('../controllers/chat.controller');
const authenticate = require('../middlewares/authenticate');

const router = express.Router();
router.use(authenticate);

// Registered before /history/:otherUserId so neither is ever captured by
// that route's :otherUserId param.
router.get('/threads', controller.threads);
router.get('/broadcast-history/:scope', controller.broadcastHistory);
router.get('/history/:otherUserId', controller.history);

module.exports = router;
