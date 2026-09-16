const stackexchangeAuthService = require('../services/stackexchangeAuth.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const connect = asyncHandler(async (req, res) => {
  const url = stackexchangeAuthService.getAuthorizeUrl(req.user);
  ApiResponse.ok(res, { url });
});

const callback = asyncHandler(async (req, res) => {
  const redirectUrl = await stackexchangeAuthService.handleCallback({
    code: req.query.code,
    state: req.query.state,
    error: req.query.error,
  });
  res.redirect(redirectUrl);
});

const disconnect = asyncHandler(async (req, res) => {
  const profile = await stackexchangeAuthService.disconnect(req.user);
  ApiResponse.ok(res, profile, 'Stack Overflow disconnected');
});

module.exports = { connect, callback, disconnect };
