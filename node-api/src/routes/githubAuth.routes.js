const express = require('express');
const githubAuthController = require('../controllers/githubAuth.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const { ROLES } = require('../config/constants');
const { authLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Authenticated fetch, not a browser navigation — a page navigation can't
// carry an Authorization header, so the frontend calls this first to get the
// authorize URL, then does the actual `window.location` redirect itself.
router.get('/connect', authenticate, authorize(ROLES.STUDENT), githubAuthController.connect);

// Unauthenticated: GitHub redirects the browser straight here with no
// Authorization header. Identity comes from the signed `state` param minted
// by /connect (see utils/oauthState.js), not from a session.
router.get('/callback', authLimiter, githubAuthController.callback);

router.delete('/disconnect', authenticate, authorize(ROLES.STUDENT), githubAuthController.disconnect);

module.exports = router;
