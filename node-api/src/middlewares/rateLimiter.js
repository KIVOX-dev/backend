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
  max: parseInt(process.env.IDENTIFY_RATE_LIMIT_MAX, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many lookup attempts, please try again later.' },
  store: storeFor('identify', IDENTIFY_WINDOW_MS),
});

// Every endpoint that proxies to ai-service/Groq (resume analyze/match-jd/
// ai-suggest/parse/improve, interview question generation, assessment
// question generation) shares this one bucket per user — see
// PROJECT_AUDIT_REPORT.md P1-5: these used to fall under only the generic
// apiLimiter, and resumeBuilder.service.js has its own comment flagging
// "an easy way to burn through the Groq quota with no accountability".
// One shared limiter (not one per route) is deliberate: the resource being
// protected is the Groq quota itself, so a user hitting 7 different AI
// routes should still draw down a single quota, not get 7x the budget by
// spreading requests across endpoints. Keyed by user id, never IP — every
// route this is applied to already runs behind `authenticate`, so req.user
// is always populated by the time this middleware executes.
const AI_WINDOW_MS = 15 * 60 * 1000;
const aiLimiter = rateLimit({
  windowMs: AI_WINDOW_MS,
  max: parseInt(process.env.AI_RATE_LIMIT_MAX, 10) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: { success: false, message: 'Too many AI requests, please try again later.' },
  store: storeFor('ai-user', AI_WINDOW_MS),
});

// Second, coarser ceiling on top of aiLimiter: caps one institution's total
// AI usage regardless of how many individual users it spreads the requests
// across, so a large institution with many accounts can't collectively
// exhaust the shared Groq quota just by virtue of headcount. Actors with no
// institution (super_admin) fall back to their own user id, matching
// canActOnStudent's own super_admin handling elsewhere — never a single
// shared "no institution" bucket every institutionless actor would compete for.
const AI_INSTITUTION_WINDOW_MS = 15 * 60 * 1000;
const aiInstitutionLimiter = rateLimit({
  windowMs: AI_INSTITUTION_WINDOW_MS,
  max: parseInt(process.env.AI_INSTITUTION_RATE_LIMIT_MAX, 10) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `institution:${req.user.institutionId || req.user.id}`,
  message: { success: false, message: "Your institution has reached its AI usage limit for this period, please try again later." },
  store: storeFor('ai-institution', AI_INSTITUTION_WINDOW_MS),
});

// /health/* is registered ahead of apiLimiter in app.js — deliberately: real
// load-balancer/orchestrator probes poll every few seconds from across
// several replicas and blew through apiLimiter's window (429s under normal
// probe volume, well below anything an actual attacker would need). But
// /health/ready and /health/metrics are still unauthenticated handlers that
// hit Mongo/Redis on every call, reachable by anyone who can reach this
// service — "no limiter at all" trades one bug for another (unbounded
// hammering of the DB via a public endpoint). This ceiling is sized well
// above any plausible probe cadence (many replicas x sub-second polling)
// while still bounding a single source's sustained request rate.
const HEALTH_WINDOW_MS = 60 * 1000;
const healthLimiter = rateLimit({
  windowMs: HEALTH_WINDOW_MS,
  max: parseInt(process.env.HEALTH_RATE_LIMIT_MAX, 10) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many health check requests, please try again later.' },
  store: storeFor('health', HEALTH_WINDOW_MS),
});

module.exports = { apiLimiter, authLimiter, identifyLimiter, aiLimiter, aiInstitutionLimiter, healthLimiter };
