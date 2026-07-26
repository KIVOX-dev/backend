const express = require('express');
const controller = require('../controllers/chat.controller');
const authenticate = require('../middlewares/authenticate');

const router = express.Router();
router.use(authenticate);

router.get('/history/:otherUserId', controller.history);

module.exports = router;
