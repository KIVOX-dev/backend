const githubAuthService = require('../services/githubAuth.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');

const connect = asyncHandler(async (req, res) => {
  const url = githubAuthService.getAuthorizeUrl(req.user);
  ApiResponse.ok(res, { url });
});

// GitHub redirects the browser here directly (no fetch, no Authorization
// header) — always ends in a redirect back to the frontend rather than a
// JSON error, since there's no caller left to read one.
const callback = asyncHandler(async (req, res) => {
  const redirectUrl = await githubAuthService.handleCallback({
    code: req.query.code,
    state: req.query.state,
    error: req.query.error,
  });
  res.redirect(redirectUrl);
});

// The signed-in student's app posts back the code/state the callback handed
// it; see githubAuth.service.js#confirm for why linking happens here.
const confirm = asyncHandler(async (req, res) => {
  const { code, state } = req.body || {};
  if (typeof code !== 'string' || typeof state !== 'string' || !code || !state) {
    throw ApiError.badRequest('code and state are required');
  }
  const status = await githubAuthService.confirm(req.user, { code, state });
  ApiResponse.ok(res, { status }, status === 'connected' ? 'GitHub connected' : 'GitHub not connected');
});

const disconnect = asyncHandler(async (req, res) => {
  const profile = await githubAuthService.disconnect(req.user);
  ApiResponse.ok(res, profile, 'GitHub disconnected');
});

module.exports = { connect, callback, confirm, disconnect };
