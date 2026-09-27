const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Binds a provider's authorize redirect back to the student who initiated
// it. The browser navigates straight to the provider and back with no
// Authorization header along the way (see githubAuth/linkedinAuth/
// stackexchangeAuth routes.js), so this signed, short-lived token — not a
// server-side session — is what tells the callback which user an
// authorization code belongs to. Reuses the access-token secret with a
// distinct issuer/audience per provider (same pattern as
// aiServiceClient.js#mintServiceToken) rather than a dedicated secret each,
// since this token never leaves our own redirect round-trip. `provider` is
// baked into the audience claim so a state token minted for one provider's
// /connect can never be replayed against a different provider's /callback.
function signState(userId, provider) {
  return jwt.sign({ sub: userId }, env.jwt.secret, {
    algorithm: 'HS256',
    issuer: 'node-api',
    audience: `${provider}-oauth-state`,
    expiresIn: '10m',
  });
}

function verifyState(state, provider) {
  return jwt.verify(state, env.jwt.secret, {
    algorithms: ['HS256'],
    issuer: 'node-api',
    audience: `${provider}-oauth-state`,
  });
}

// PKCE (RFC 7636) for providers that support it. The verifier is an HMAC of
// the state under a key derived from JWT_SECRET (same derivation pattern as
// signedUrl.js), so the callback can recompute it from the state it gets back
// with nothing stored server-side. Only the S256 challenge ever leaves the
// server, so a code intercepted on the way back is useless without it.
const PKCE_KEY = crypto.createHash('sha256').update(`${env.jwt.secret}:oauth-pkce-verifier`).digest();

function pkceVerifier(state) {
  return crypto.createHmac('sha256', PKCE_KEY).update(state).digest('base64url');
}

function pkceChallenge(state) {
  return crypto.createHash('sha256').update(pkceVerifier(state)).digest('base64url');
}

module.exports = { signState, verifyState, pkceVerifier, pkceChallenge };
