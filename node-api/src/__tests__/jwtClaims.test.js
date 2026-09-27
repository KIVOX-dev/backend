// Unit tests for utils/jwt.js's issuer/audience checks — in particular that
// no other token signed with JWT_SECRET (an OAuth `state`) passes as a
// user's access token.
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/unused';
process.env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret';

const jwt = require('jsonwebtoken');
const { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } = require('../utils/jwt');
const { signState } = require('../utils/oauthState');

const payload = { sub: 'user-1', role: 'student', institutionId: null, tv: 0 };

describe('access tokens', () => {
  it('carry and pass the issuer/audience check', () => {
    const decoded = verifyAccessToken(signAccessToken(payload));
    expect(decoded).toMatchObject({ sub: 'user-1', iss: 'node-api', aud: 'talentsnaps-access' });
  });

  it('rejects an OAuth state token signed with the same secret', () => {
    expect(() => verifyAccessToken(signState('user-1', 'github'))).toThrow();
  });

  it('rejects a token with no issuer/audience', () => {
    const legacy = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
    expect(() => verifyAccessToken(legacy)).toThrow();
  });

  it('rejects a refresh token', () => {
    expect(() => verifyAccessToken(signRefreshToken(payload))).toThrow();
  });
});

describe('refresh tokens', () => {
  it('carry and pass the issuer/audience check', () => {
    const decoded = verifyRefreshToken(signRefreshToken(payload));
    expect(decoded).toMatchObject({ sub: 'user-1', iss: 'node-api', aud: 'talentsnaps-refresh' });
  });

  it('still accepts one signed before issuer/audience existed', () => {
    const legacy = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
    expect(verifyRefreshToken(legacy)).toMatchObject({ sub: 'user-1' });
  });

  it('rejects a wrong audience', () => {
    const other = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { issuer: 'node-api', audience: 'something-else' });
    expect(() => verifyRefreshToken(other)).toThrow();
  });

  it('rejects an access token', () => {
    expect(() => verifyRefreshToken(signAccessToken(payload))).toThrow();
  });
});

describe('GitHub OAuth PKCE', () => {
  const crypto = require('crypto');
  const { pkceChallenge, pkceVerifier } = require('../utils/oauthState');

  it('challenge is the S256 hash of the verifier recomputed from the same state', () => {
    const state = signState('user-1', 'github');
    const expected = crypto.createHash('sha256').update(pkceVerifier(state)).digest('base64url');
    expect(pkceChallenge(state)).toBe(expected);
    expect(pkceVerifier(state)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('differs per state', () => {
    expect(pkceVerifier(signState('user-1', 'github'))).not.toBe(pkceVerifier(signState('user-2', 'github')));
  });
});
