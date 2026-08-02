const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('./logger');

// Signed for the AI service alone (see ai-service/app/security.py#verify_service_token) —
// short-lived on purpose: this token is minted fresh for every call, never
// stored or reused, so a leaked log line containing it is worthless within
// seconds.
function mintServiceToken() {
  return jwt.sign({}, env.aiService.sharedSecret, {
    algorithm: 'HS256',
    issuer: 'node-api',
    audience: 'ai-service',
    expiresIn: '60s',
  });
}

// Thrown when the AI service itself can't be reached at all (network error,
// timeout, DNS failure) — as opposed to AiServiceUpstreamError, which means
// the service WAS reached and returned a deliberate error response. Callers
// treat this one as "degrade gracefully", the other as "surface what the
// service said."
class AiServiceUnavailableError extends Error {}

class AiServiceUpstreamError extends Error {
  constructor(statusCode, detail) {
    super(detail || `AI service returned ${statusCode}`);
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

async function callAiService(path, body) {
  if (!env.aiService.sharedSecret) {
    logger.error('AI service shared secret is not configured');
    throw new AiServiceUnavailableError('AI service shared secret is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.aiService.timeoutMs);

  let response;
  try {
    response = await fetch(`${env.aiService.url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mintServiceToken()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    logger.error('AI service request failed', { path, error: err.message });
    throw new AiServiceUnavailableError(err.message);
  } finally {
    clearTimeout(timeout);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // fall through with data === null — handled by the !response.ok branch below
  }

  if (!response.ok) {
    const detail = data && typeof data.detail === 'string' ? data.detail : null;
    throw new AiServiceUpstreamError(response.status, detail);
  }

  return data;
}

module.exports = { callAiService, mintServiceToken, AiServiceUnavailableError, AiServiceUpstreamError };
