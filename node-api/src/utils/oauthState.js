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

module.exports = { signState, verifyState };
