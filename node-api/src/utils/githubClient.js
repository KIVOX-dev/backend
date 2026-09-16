const logger = require('./logger');

const REQUEST_TIMEOUT_MS = 10000;

// Thrown for both "couldn't reach GitHub" and "GitHub rejected the request" —
// unlike aiServiceClient.js's two-class split, the caller here (githubAuth.service.js)
// treats every failure the same way (redirect back to the frontend with a
// generic error reason), so one class is enough.
class GitHubOAuthError extends Error {}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    throw new GitHubOAuthError(err.message);
  } finally {
    clearTimeout(timeout);
  }
}

// GitHub's token endpoint returns HTTP 200 with an `error` field on failure
// (e.g. a reused/expired code) rather than a non-2xx status, so both cases
// need an explicit check.
async function exchangeCodeForToken({ code, clientId, clientSecret, redirectUri }) {
  const response = await fetchWithTimeout('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error || !data.access_token) {
    logger.error('GitHub token exchange rejected', { status: response.status, error: data && data.error_description });
    throw new GitHubOAuthError((data && data.error_description) || 'GitHub rejected the authorization code');
  }
  return data.access_token;
}

async function fetchGitHubUser(accessToken) {
  const response = await fetchWithTimeout('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      // Required by GitHub's API for every request, regardless of auth.
      'User-Agent': 'talentsnaps-node-api',
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new GitHubOAuthError('GitHub rejected the access token');
  }
  return { id: String(data.id), username: data.login, avatarUrl: data.avatar_url };
}

module.exports = { exchangeCodeForToken, fetchGitHubUser, GitHubOAuthError };
