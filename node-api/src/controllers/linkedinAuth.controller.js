const linkedinAuthService = require('../services/linkedinAuth.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');

const connect = asyncHandler(async (req, res) => {
  const url = linkedinAuthService.getAuthorizeUrl(req.user);
  ApiResponse.ok(res, { url });
});

const callback = asyncHandler(async (req, res) => {
  const redirectUrl = await linkedinAuthService.handleCallback({
    code: req.query.code,
    state: req.query.state,
    error: req.query.error,
  });
  res.redirect(redirectUrl);
});

// The signed-in student's app posts back the code/state the callback handed
// it; see linkedinAuth.service.js#confirm for why linking happens here.
const confirm = asyncHandler(async (req, res) => {
  const { code, state } = req.body || {};
  if (typeof code !== 'string' || typeof state !== 'string' || !code || !state) {
    throw ApiError.badRequest('code and state are required');
  }
  const status = await linkedinAuthService.confirm(req.user, { code, state });
  ApiResponse.ok(res, { status }, status === 'connected' ? 'LinkedIn connected' : 'LinkedIn not connected');
});

const disconnect = asyncHandler(async (req, res) => {
  const profile = await linkedinAuthService.disconnect(req.user);
  ApiResponse.ok(res, profile, 'LinkedIn disconnected');
});

module.exports = { connect, callback, confirm, disconnect };
