const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Binds a GitHub authorize redirect back to the student who initiated it.
// The browser navigates straight to GitHub and back with no Authorization
// header along the way (see githubAuth.routes.js), so this signed, short-lived
// token — not a server-side session — is what tells the callback which user
// this authorization code belongs to. Reuses the access-token secret with a
// distinct issuer/audience (same pattern as aiServiceClient.js#mintServiceToken)
// rather than a dedicated secret, since this token never leaves our own
// redirect round-trip.
function signState(userId) {
  return jwt.sign({ sub: userId }, env.jwt.secret, {
    algorithm: 'HS256',
    issuer: 'node-api',
    audience: 'github-oauth-state',
    expiresIn: '10m',
  });
}

function verifyState(state) {
  return jwt.verify(state, env.jwt.secret, {
    algorithms: ['HS256'],
    issuer: 'node-api',
    audience: 'github-oauth-state',
  });
}

module.exports = { signState, verifyState };
