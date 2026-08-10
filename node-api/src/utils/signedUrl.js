const crypto = require('crypto');
const env = require('../config/env');

// Short-lived, HMAC-signed access to a specific static file path — used for
// placement-proof documents (see routes/placementRecord.routes.js), which
// used to be served by app.js's plain express.static('/uploads') mount with
// no auth at all (PROJECT_AUDIT_REPORT.md P1-7). A Bearer-token gate can't
// work here: the frontend opens these in a new browser tab
// (`<a target="_blank">` / window.open), and a plain browser navigation
// never carries an Authorization header. Signed URLs are the standard fix —
// short expiry, and issuing one at all requires passing the same
// ownership/institution check as every other per-record endpoint (see
// placementRecord.service.js#getProofUrl).
//
// Keyed off a derivation of JWT_SECRET rather than a new required env var —
// this app already treats that secret as the one thing every deploy must
// set (see config/env.js's required-at-boot list), and deriving a
// namespaced sub-key from it (rather than reusing it directly) keeps this
// use cryptographically separate from token signing.
const SIGNING_KEY = crypto.createHash('sha256').update(`${env.jwt.secret}:placement-proof-url`).digest();

const DEFAULT_TTL_SECONDS = 120;

function signature(relativePath, exp) {
  return crypto.createHmac('sha256', SIGNING_KEY).update(`${relativePath}:${exp}`).digest('base64url');
}

// Returns the same relativePath with `?token=...&exp=...` appended.
function sign(relativePath, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const exp = Date.now() + ttlSeconds * 1000;
  const token = signature(relativePath, exp);
  const separator = relativePath.includes('?') ? '&' : '?';
  return `${relativePath}${separator}token=${token}&exp=${exp}`;
}

function verify(relativePath, token, exp) {
  if (!token || !exp) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;

  const expected = Buffer.from(signature(relativePath, expNum));
  const actual = Buffer.from(String(token));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = { sign, verify };
