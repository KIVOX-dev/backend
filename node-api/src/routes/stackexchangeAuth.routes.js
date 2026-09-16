const express = require('express');
const stackexchangeAuthController = require('../controllers/stackexchangeAuth.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const { ROLES } = require('../config/constants');
const { authLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

router.get('/connect', authenticate, authorize(ROLES.STUDENT), stackexchangeAuthController.connect);
router.get('/callback', authLimiter, stackexchangeAuthController.callback);
router.delete('/disconnect', authenticate, authorize(ROLES.STUDENT), stackexchangeAuthController.disconnect);

module.exports = router;
