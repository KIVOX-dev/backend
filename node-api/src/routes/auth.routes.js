const express = require('express');
const authController = require('../controllers/auth.controller');
const validate = require('../middlewares/validate');
const authenticate = require('../middlewares/authenticate');
const verifyTurnstile = require('../middlewares/verifyTurnstile');
const { authLimiter } = require('../middlewares/rateLimiter');
const schema = require('../validations/auth.validation');

const router = express.Router();

router.post(
  '/register',
  authLimiter,
  validate(schema.register),
  verifyTurnstile('register'),
  authController.register
);
router.post('/login', authLimiter, validate(schema.login), verifyTurnstile('login'), authController.login);
router.post('/google', authLimiter, validate(schema.googleLogin), authController.googleLogin);

// Explicit "Connect Google account" from Settings — same idToken shape as
// /google above (validated by the same schema), but authenticated and
// additive rather than login/signup.
router.post('/google/link', authenticate, authLimiter, validate(schema.googleLogin), authController.googleLink);
router.delete('/google/unlink', authenticate, authLimiter, authController.googleUnlink);

// Called on every page load now that the refresh token lives in an httpOnly
// cookie (see utils/refreshCookie.js), so it's left to the global apiLimiter:
// authLimiter's 20/15min per IP would log out a whole campus behind one NAT,
// and a refresh token isn't something that can be brute-forced.
router.post('/refresh', validate(schema.refresh), authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.me);
router.get('/me/activity-heatmap', authenticate, authController.activityHeatmap);

// Same authLimiter as login/register — these are exactly the kind of
// endpoint credential-stuffing/enumeration tooling targets.
router.post(
  '/forgot-password',
  authLimiter,
  validate(schema.forgotPassword),
  verifyTurnstile('forgot_password'),
  authController.forgotPassword
);
router.post('/reset-password', authLimiter, validate(schema.resetPassword), authController.resetPassword);
router.post(
  '/change-initial-password',
  authLimiter,
  validate(schema.changeInitialPassword),
  authController.changeInitialPassword
);
router.get('/verify-email', authLimiter, validate(schema.verifyEmail, 'query'), authController.verifyEmail);

// Authenticated password change — distinct from forgot/reset (token-based,
// unauthenticated) and change-initial-password (temp-password onboarding).
router.put(
  '/change-password',
  authenticate,
  authLimiter,
  validate(schema.changePassword),
  authController.changePassword
);

module.exports = router;
