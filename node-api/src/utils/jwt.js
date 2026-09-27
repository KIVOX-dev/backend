const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Every user token names who issued it and what it's for. Other tokens are
// signed with the same secret (oauthState.js reuses JWT_SECRET for the
// GitHub/LinkedIn/StackExchange `state` round-trip), so without an audience
// check a { sub } state token lifted from a provider redirect URL passed
// verifyAccessToken and authenticated as that user.
const ISSUER = 'node-api';
const ACCESS_AUDIENCE = 'talentsnaps-access';
const REFRESH_AUDIENCE = 'talentsnaps-refresh';

function signAccessToken(payload) {
  return jwt.sign(payload, env.jwt.secret, {
    algorithm: 'HS256',
    issuer: ISSUER,
    audience: ACCESS_AUDIENCE,
    expiresIn: env.jwt.expiresIn,
  });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, env.jwt.refreshSecret, {
    algorithm: 'HS256',
    issuer: ISSUER,
    audience: REFRESH_AUDIENCE,
    expiresIn: env.jwt.refreshExpiresIn,
  });
}

// algorithms pinned explicitly (defense-in-depth against algorithm-confusion
// attacks) rather than relying on jsonwebtoken's implicit HMAC-only default
// for string secrets — matches ai-service/app/security.py's verify_service_token.
//
// Access tokens are checked strictly: ones signed before iss/aud existed
// are at most JWT_EXPIRES_IN old, and the frontend refreshes on the 401.
function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.secret, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: ACCESS_AUDIENCE,
  });
}

// Refresh tokens signed before iss/aud were added carry neither claim.
// Accepting those keeps every existing session alive through the deploy;
// JWT_REFRESH_SECRET signs nothing but refresh tokens, so this can't admit
// any other kind of token. Delete the legacy branch once JWT_REFRESH_EXPIRES_IN
// (7 days by default) has passed since the deploy.
function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.jwt.refreshSecret, { algorithms: ['HS256'] });
  const isLegacy = payload.iss === undefined && payload.aud === undefined;
  if (!isLegacy && (payload.iss !== ISSUER || payload.aud !== REFRESH_AUDIENCE)) {
    throw new jwt.JsonWebTokenError('jwt issuer or audience invalid');
  }
  return payload;
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, ISSUER, ACCESS_AUDIENCE };
