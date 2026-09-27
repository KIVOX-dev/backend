const jwt = require('jsonwebtoken');
const env = require('../config/env');

// The refresh token lives only in this httpOnly cookie — never in a response
// body — so script running on the frontend (an XSS bug included) can't read
// it or carry it off. The frontend keeps just the short-lived access token,
// in memory, and gets a new one from POST /auth/refresh on page load.
//
// SameSite=Strict still reaches us from www.talentsnaps.com: the API is on
// api.talentsnaps.com, the same site. Scoped to the auth routes so the
// cookie isn't sent with every other API call.
const NAME = 'ts_refresh';
const PATH = `${env.apiPrefix}/auth`;

function baseOptions() {
  return { httpOnly: true, secure: env.isProduction, sameSite: 'strict', path: PATH };
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
