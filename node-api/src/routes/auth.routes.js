const express = require('express');
const authController = require('../controllers/auth.controller');
const validate = require('../middlewares/validate');
const authenticate = require('../middlewares/authenticate');
const { authLimiter } = require('../middlewares/rateLimiter');
const schema = require('../validations/auth.validation');

const router = express.Router();

router.post('/register', authLimiter, validate(schema.register), authController.register);
router.post('/login', authLimiter, validate(schema.login), authController.login);
router.post('/google', authLimiter, validate(schema.googleLogin), authController.googleLogin);
router.post('/refresh', authLimiter, validate(schema.refresh), authController.refresh);
router.get('/me', authenticate, authController.me);

// Same authLimiter as login/register — these are exactly the kind of
// endpoint credential-stuffing/enumeration tooling targets.
router.post('/forgot-password', authLimiter, validate(schema.forgotPassword), authController.forgotPassword);
router.post('/reset-password', authLimiter, validate(schema.resetPassword), authController.resetPassword);
router.post(
  '/change-initial-password',
  authLimiter,
  validate(schema.changeInitialPassword),
  authController.changeInitialPassword
);
router.get('/verify-email', authLimiter, validate(schema.verifyEmail, 'query'), authController.verifyEmail);

module.exports = router;
