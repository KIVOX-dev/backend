const express = require('express');
const controller = require('../controllers/leaderboard.controller');
const authenticate = require('../middlewares/authenticate');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.get);

module.exports = router;
