const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');
const env = require('../config/env');
const logger = require('./logger');

// Signed for the AI service alone (see ai-service/app/security.py#verify_service_token) —
// short-lived on purpose: this token is minted fresh for every call, never
// stored or reused, so a leaked log line containing it is worthless within
// seconds. Sent as X-Service-Token, not Authorization — Authorization is
// reserved for the Cloud Run IAM identity token below; the two would
// otherwise collide on the same header.
function mintServiceToken() {
  return jwt.sign({}, env.aiService.sharedSecret, {
    algorithm: 'HS256',
    issuer: 'node-api',
    audience: 'ai-service',
    expiresIn: '60s',
  });
}

// The AI service's Cloud Run deployment is --no-allow-unauthenticated —
// only callers presenting a Google-signed identity token for an
// authorized principal get past Cloud Run's own IAM layer before a
// request ever reaches the app (and its verify_service_token check)
// at all. A single cached GoogleAuth instance mints a fresh ID token
// per call, scoped to the AI service's own URL as the audience — the
// same pattern Cloud Run's own docs use for service-to-service calls.
// google-auth-library resolves credentials automatically: the attached
// service account's metadata-server identity when actually running on
// Cloud Run, or Application Default Credentials locally if configured.
const googleAuth = new GoogleAuth();
let idTokenClientPromise = null;

// Local dev's ai-service (http://localhost:8001, env.js's own default)
// isn't behind Cloud Run IAM and has no Google-signed identity to check
// against — skip minting an ID token entirely rather than failing every
// local request behind credentials a dev machine has no reason to have.
function isLocalAiService() {
  try {
    return new URL(env.aiService.url).hostname === 'localhost';
  } catch {
    return false;
  }
}

async function getGoogleIdToken() {
  if (!idTokenClientPromise) {
    idTokenClientPromise = googleAuth.getIdTokenClient(env.aiService.url);
  }
  const client = await idTokenClientPromise;
  return client.idTokenProvider.fetchIdToken(env.aiService.url);
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

  const headers = {
    'Content-Type': 'application/json',
    'X-Service-Token': `Bearer ${mintServiceToken()}`,
  };
  if (!isLocalAiService()) {
    try {
      headers.Authorization = `Bearer ${await getGoogleIdToken()}`;
    } catch (err) {
      // Surface this as unavailable rather than letting it fall through to
      // Cloud Run's own 403 below — that 403 comes back as an HTML error
      // page from Google's frontend, not JSON, which read as an opaque
      // "AI suggestion failed" with no indication IAM was even the problem.
      logger.error('Failed to mint a Google ID token for the AI service call', { path, error: err.message });
      throw new AiServiceUnavailableError(`Could not authenticate to the AI service: ${err.message}`);
    }
  }

  let response;
  try {
    response = await fetch(`${env.aiService.url}${path}`, {
      method: 'POST',
      headers,
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
