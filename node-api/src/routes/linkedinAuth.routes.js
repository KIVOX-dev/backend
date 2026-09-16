const express = require('express');
const linkedinAuthController = require('../controllers/linkedinAuth.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const { ROLES } = require('../config/constants');
const { authLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

router.get('/connect', authenticate, authorize(ROLES.STUDENT), linkedinAuthController.connect);
router.get('/callback', authLimiter, linkedinAuthController.callback);
router.delete('/disconnect', authenticate, authorize(ROLES.STUDENT), linkedinAuthController.disconnect);

module.exports = router;
