const linkedinAuthService = require('../services/linkedinAuth.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

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

const disconnect = asyncHandler(async (req, res) => {
  const profile = await linkedinAuthService.disconnect(req.user);
  ApiResponse.ok(res, profile, 'LinkedIn disconnected');
});

module.exports = { connect, callback, disconnect };
