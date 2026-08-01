const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { HybridRateLimitStore } = require('./rateLimitStore');

// Redis-backed when REDIS_URL is set (shared limits across every node-api
// instance — required once this runs behind a load balancer with more than
// one replica), falls back to the same in-memory behavior as before when it
// isn't. Store swap only — the exported limiters below are otherwise
// unchanged, so every route.use(apiLimiter)/authLimiter/identifyLimiter call
// site needs no changes at all.
function storeFor(name, windowMs) {
  return new HybridRateLimitStore({ prefix: `rl:${name}:`, windowMs });
}

// General API limiter, applied globally.
const apiLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
  store: storeFor('api', env.rateLimit.windowMs),
});

// Stricter limiter for login/register/OAuth to blunt credential-stuffing and
// brute force. Configurable the same way apiLimiter is above — defaults to
// the same 20/15min in every real deployment; only overridden in the
// integration test suite (see __tests__/helpers/testApp.js), where dozens of
// auth calls in one file would otherwise trip it well before any real
// brute-force threshold is relevant.
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts, please try again later.' },
  store: storeFor('auth', AUTH_WINDOW_MS),
});

// Public, unauthenticated kiosk lookup (see student.routes.js#/identify) —
// tight limit since it's a no-login endpoint that resolves a college+roll
// pair to a real student record.
const IDENTIFY_WINDOW_MS = 15 * 60 * 1000;
const identifyLimiter = rateLimit({
  windowMs: IDENTIFY_WINDOW_MS,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many lookup attempts, please try again later.' },
  store: storeFor('identify', IDENTIFY_WINDOW_MS),
});

module.exports = { apiLimiter, authLimiter, identifyLimiter };
