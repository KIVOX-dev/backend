const jwt = require('jsonwebtoken');
const env = require('../config/env');

function signAccessToken(payload) {
  return jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshExpiresIn });
}

// algorithms pinned explicitly (defense-in-depth against algorithm-confusion
// attacks) rather than relying on jsonwebtoken's implicit HMAC-only default
// for string secrets — matches ai-service/app/security.py's verify_service_token.
function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.secret, { algorithms: ['HS256'] });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret, { algorithms: ['HS256'] });
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
