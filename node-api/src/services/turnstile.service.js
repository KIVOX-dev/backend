// Server-side verification for Cloudflare Turnstile. Per Cloudflare's own
// guidance, this check MUST happen server-side — the widget's token is only
// ever trustworthy after this round trip confirms it with Cloudflare.
const env = require('../config/env');
const logger = require('../utils/logger');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TOKEN_LENGTH = 2048;

// action: the `data-action` the frontend widget was rendered with (e.g.
// 'register', 'forgot_password') — checked against siteverify's response so
// a token minted for one form can't be replayed against another endpoint.
async function verifyToken(token, remoteIp, action) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { success: false, reason: 'invalid_token_format' };
  }

  let result;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: new URLSearchParams({
        secret: env.turnstile.secretKey,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
    });
    if (!response.ok) throw new Error(`siteverify responded ${response.status}`);
    result = await response.json();
  } catch (err) {
    logger.error('Turnstile siteverify request failed', { error: err.message });
    return { success: false, reason: 'siteverify_request_failed' };
  }

  if (!result.success) {
    return { success: false, reason: 'siteverify_rejected', errorCodes: result['error-codes'] };
  }
  if (action && result.action !== action) {
    logger.warn('Turnstile token action mismatch', { expected: action, received: result.action });
    return { success: false, reason: 'action_mismatch' };
  }
  if (env.turnstile.allowedHostnames.length > 0 && !env.turnstile.allowedHostnames.includes(result.hostname)) {
    logger.warn('Turnstile token hostname mismatch', { hostname: result.hostname });
    return { success: false, reason: 'hostname_mismatch' };
  }

  return { success: true };
}

module.exports = { verifyToken };
