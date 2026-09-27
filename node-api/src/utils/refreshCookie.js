const jwt = require('jsonwebtoken');
const env = require('../config/env');

// The refresh token lives only in this httpOnly cookie — never in a response
// body — so script running on the frontend (an XSS bug included) can't read
// it or carry it off. The frontend keeps just the short-lived access token,
// in memory, and gets a new one from POST /auth/refresh on page load.
//
// In production the API is on its Cloud Run URL (*.run.app), a different
// site from www.talentsnaps.com, so SameSite=Strict/Lax cookies are never
// sent and every reload or new tab lost the session. SameSite=None lets the
// browser send it; Partitioned (CHIPS) keys it to the top-level site, so it
// only goes out while the visitor is on talentsnaps.com — a page on any
// other site gets a separate, empty jar, which also rules out CSRF — and it
// keeps working where third-party cookies are blocked. Local dev stays
// SameSite=Strict: localhost:3000 -> localhost:5000 is same-site, and
// SameSite=None requires Secure (HTTPS). Scoped to the auth routes so the
// cookie isn't sent with every other API call.
const NAME = 'ts_refresh';
const PATH = `${env.apiPrefix}/auth`;

function baseOptions() {
  return env.isProduction
    ? { httpOnly: true, secure: true, sameSite: 'none', partitioned: true, path: PATH }
    : { httpOnly: true, secure: false, sameSite: 'strict', path: PATH };
}

function setRefreshCookie(res, refreshToken) {
  const { exp } = jwt.decode(refreshToken) || {};
  res.cookie(NAME, refreshToken, { ...baseOptions(), ...(exp ? { expires: new Date(exp * 1000) } : {}) });
}

function clearRefreshCookie(res) {
  res.clearCookie(NAME, baseOptions());
}

function readRefreshCookie(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

module.exports = { setRefreshCookie, clearRefreshCookie, readRefreshCookie };
