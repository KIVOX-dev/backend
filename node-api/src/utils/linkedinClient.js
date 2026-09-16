const logger = require('./logger');

const REQUEST_TIMEOUT_MS = 10000;

class LinkedInOAuthError extends Error {}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    throw new LinkedInOAuthError(err.message);
  } finally {
    clearTimeout(timeout);
  }
}

async function exchangeCodeForToken({ code, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetchWithTimeout('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !data.access_token) {
    logger.error('LinkedIn token exchange rejected', { status: response.status, error: data && data.error_description });
    throw new LinkedInOAuthError((data && data.error_description) || 'LinkedIn rejected the authorization code');
  }
  return data.access_token;
}

// "Sign In with LinkedIn using OpenID Connect" only — the openid/profile/
// email scope tier. Returns verified identity (name, email, photo), never
// work history or skills, which require LinkedIn's separately gated
// Marketing Developer Platform partnership this app doesn't have.
async function fetchLinkedInUser(accessToken) {
  const response = await fetchWithTimeout('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new LinkedInOAuthError('LinkedIn rejected the access token');
  }
  return { id: String(data.sub), name: data.name, email: data.email, avatarUrl: data.picture };
}

module.exports = { exchangeCodeForToken, fetchLinkedInUser, LinkedInOAuthError };
