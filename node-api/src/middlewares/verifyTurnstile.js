const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const turnstileService = require('../services/turnstile.service');

// Route-level gate for Cloudflare Turnstile — place after validate() so
// req.body.turnstileToken has already been type-checked by Joi.
// `action` must match the `data-action` the frontend rendered the widget
// with (see docs/API.md) — mismatches are treated as a failed verification,
// same as a missing/invalid token, so the caller never learns which check
// failed.
function verifyTurnstile(action) {
  return asyncHandler(async (req, res, next) => {
    const result = await turnstileService.verifyToken(req.body.turnstileToken, req.ip, action);
    if (!result.success) {
      throw ApiError.forbidden('Verification failed. Please refresh and try again.', 'TURNSTILE_FAILED');
    }
    next();
  });
}

module.exports = verifyTurnstile;
