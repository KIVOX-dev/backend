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

// Contribution calendars are public GitHub data — any valid token can read
// any public user's, so `appToken` here is always the app's own token (see
// env.js's comment), never the individual student's. Returns a flat
// {date, count}[] already shaped to match auth.service.js#activityHeatmap's
// existing response contract, so the frontend needs no changes to consume it.
async function fetchContributionCalendar(username, appToken) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks { contributionDays { date contributionCount } }
          }
        }
      }
    }
  `;

  const response = await fetchWithTimeout('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'talentsnaps-node-api',
    },
    body: JSON.stringify({ query, variables: { login: username } }),
  });

  const data = await response.json().catch(() => null);
  const calendar = data?.data?.user?.contributionsCollection?.contributionCalendar;
  if (!response.ok || !calendar) {
    logger.error('GitHub contribution calendar fetch failed', {
      status: response.status,
      error: data && data.errors && data.errors[0] && data.errors[0].message,
    });
    throw new GitHubOAuthError('Could not fetch GitHub contributions');
  }

  return calendar.weeks
    .flatMap((week) => week.contributionDays)
    .map((day) => ({ date: day.date, count: day.contributionCount }));
}

module.exports = { exchangeCodeForToken, fetchGitHubUser, fetchContributionCalendar, GitHubOAuthError };
