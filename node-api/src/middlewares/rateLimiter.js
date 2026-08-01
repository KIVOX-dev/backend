const rateLimit = require('express-rate-limit');
const env = require('../config/env');

// General API limiter, applied globally.
const apiLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

// Stricter limiter for login/register/OAuth to blunt credential-stuffing and
// brute force. Configurable the same way apiLimiter is above — defaults to
// the same 20/15min in every real deployment; only overridden in the
// integration test suite (see __tests__/helpers/testApp.js), where dozens of
// auth calls in one file would otherwise trip it well before any real
// brute-force threshold is relevant.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts, please try again later.' },
});

// Public, unauthenticated kiosk lookup (see student.routes.js#/identify) —
// tight limit since it's a no-login endpoint that resolves a college+roll
// pair to a real student record.
const identifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many lookup attempts, please try again later.' },
});

module.exports = { apiLimiter, authLimiter, identifyLimiter };
