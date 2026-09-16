const logger = require('./logger');

const REQUEST_TIMEOUT_MS = 8000;

// Thrown only when the site DEFINITIVELY says the username doesn't exist —
// callers treat this as a hard rejection. Every other failure (timeout, the
// site changing its unofficial API, a transient block) is logged and
// swallowed by each verify* function below rather than thrown — these are
// unofficial endpoints on sites with no real OAuth/public API (see
// githubAuth.service.js's comment on why GitHub alone gets a real connect
// flow), so "couldn't verify right now" must degrade to "save anyway", never
// block a real username over an unrelated outage.
class SocialProfileNotFoundError extends Error {}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyLeetcodeUsername(username) {
  try {
    const response = await fetchWithTimeout('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query($username: String!) { matchedUser(username: $username) { username } }',
        variables: { username },
      }),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data && data.data && data.data.matchedUser === null) {
      throw new SocialProfileNotFoundError(`No LeetCode user "${username}"`);
    }
  } catch (err) {
    if (err instanceof SocialProfileNotFoundError) throw err;
    logger.error('LeetCode verification unavailable — saving unverified', { username, error: err.message });
  }
}

async function verifyHackerrankUsername(username) {
  try {
    // Unofficial, but the same endpoint hackerrank.com's own profile page
    // calls client-side — not the enterprise/partner API (see
    // docs mentioned in githubAuth work: HackerRank has no public OAuth for
    // an individual to connect their own account to a third party).
    const response = await fetchWithTimeout(
      `https://www.hackerrank.com/rest/contests/master/hackers/${encodeURIComponent(username)}/profile`,
      { headers: { 'User-Agent': 'talentsnaps-node-api' } }
    );
    if (response.status === 404) {
      throw new SocialProfileNotFoundError(`No HackerRank user "${username}"`);
    }
    const data = await response.json().catch(() => null);
    if (response.ok && data && data.status === false) {
      throw new SocialProfileNotFoundError(`No HackerRank user "${username}"`);
    }
  } catch (err) {
    if (err instanceof SocialProfileNotFoundError) throw err;
    logger.error('HackerRank verification unavailable — saving unverified', { username, error: err.message });
  }
}

async function verifyDribbbleUsername(username) {
  try {
    const response = await fetchWithTimeout(`https://dribbble.com/${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; talentsnaps-node-api)' },
    });
    if (response.status === 404) {
      throw new SocialProfileNotFoundError(`No Dribbble user "${username}"`);
    }
  } catch (err) {
    if (err instanceof SocialProfileNotFoundError) throw err;
    logger.error('Dribbble verification unavailable — saving unverified', { username, error: err.message });
  }
}

module.exports = {
  verifyLeetcodeUsername,
  verifyHackerrankUsername,
  verifyDribbbleUsername,
  SocialProfileNotFoundError,
};
