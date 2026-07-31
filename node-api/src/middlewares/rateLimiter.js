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

// Stricter limiter for login/register/OAuth to blunt credential-stuffing and brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
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
