const logger = require('./logger');

const REQUEST_TIMEOUT_MS = 10000;

class StackExchangeOAuthError extends Error {}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    throw new StackExchangeOAuthError(err.message);
  } finally {
    clearTimeout(timeout);
  }
}

async function exchangeCodeForToken({ code, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetchWithTimeout('https://stackoverflow.com/oauth/access_token/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !data.access_token) {
    logger.error('Stack Exchange token exchange rejected', { status: response.status, error: data && data.error_description });
    throw new StackExchangeOAuthError((data && data.error_description) || 'Stack Overflow rejected the authorization code');
  }
  return data.access_token;
}

// `key` is the separate "app key" Stack Exchange issues alongside client
// id/secret — required on every API call together with the access token,
// not a substitute for it.
async function fetchStackExchangeUser(accessToken, key) {
  const params = new URLSearchParams({
    order: 'desc',
    sort: 'reputation',
    site: 'stackoverflow',
    access_token: accessToken,
    key,
  });

  const response = await fetchWithTimeout(`https://api.stackexchange.com/2.3/me?${params.toString()}`);

  const data = await response.json().catch(() => null);
  const user = data && Array.isArray(data.items) ? data.items[0] : null;
  if (!response.ok || !user) {
    throw new StackExchangeOAuthError('Stack Overflow rejected the access token');
  }
  return {
    id: String(user.user_id),
    displayName: user.display_name,
    reputation: user.reputation,
    avatarUrl: user.profile_image,
    profileUrl: user.link,
  };
}

module.exports = { exchangeCodeForToken, fetchStackExchangeUser, StackExchangeOAuthError };
