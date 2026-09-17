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

// Real stats for the Integrations tab's HackerRank card — level/title/
// follower count from the profile endpoint (see verifyHackerrankUsername
// above for the same endpoint) plus per-skill badges (name, stars earned,
// problems solved) from HackerRank's own public badges endpoint, verified
// directly against real accounts to confirm the field shape before writing
// this. Throws on failure (doesn't swallow) — same reasoning as
// fetchLeetcodeStats below: this backs a screen the student is actively
// looking at, not a background save.
async function fetchHackerrankStats(username) {
  const [profileResponse, badgesResponse] = await Promise.all([
    fetchWithTimeout(`https://www.hackerrank.com/rest/contests/master/hackers/${encodeURIComponent(username)}/profile`, {
      headers: { 'User-Agent': 'talentsnaps-node-api' },
    }),
    fetchWithTimeout(`https://www.hackerrank.com/rest/hackers/${encodeURIComponent(username)}/badges`, {
      headers: { 'User-Agent': 'talentsnaps-node-api' },
    }),
  ]);

  const profileData = await profileResponse.json().catch(() => null);
  if (!profileResponse.ok || !profileData || !profileData.model) {
    throw new SocialProfileNotFoundError(`No HackerRank user "${username}"`);
  }
  const badgesData = await badgesResponse.json().catch(() => null);

  const model = profileData.model;
  // e.g. "O(2<sup>N</sup>)" -> "O(2^N)" — HackerRank embeds HTML superscript
  // tags in this field for its own site's rendering; strip them for plain text.
  const title = model.title ? model.title.replace(/<sup>/g, '^').replace(/<\/sup>/g, '') : null;

  return {
    level: model.level ?? null,
    title,
    followers: model.followers_count ?? 0,
    badges: (badgesData && Array.isArray(badgesData.models) ? badgesData.models : []).map((b) => ({
      name: b.badge_name,
      stars: b.stars ?? 0,
      totalStars: b.total_stars ?? 0,
      solved: b.solved ?? 0,
      totalChallenges: b.total_challenges ?? 0,
    })),
  };
}

// Real stats, not just "connected as @x" — global rank, solved counts by
// difficulty, and a submission calendar shaped identically to
// auth.service.js#activityHeatmap's {date, count}[] contract (so the
// frontend can reuse the same heatmap renderer built for GitHub). Throws
// (rather than swallowing, unlike verifyLeetcodeUsername above) since this
// is called on-demand by a screen the student is actively looking at, where
// a stale-but-silent failure would be worse than a visible "couldn't load"
// state — see studentProfile.service.js#getLeetcodeStats, the one caller.
async function fetchLeetcodeStats(username) {
  const response = await fetchWithTimeout('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query userStats($username: String!) {
          matchedUser(username: $username) {
            username
            submitStats: submitStatsGlobal {
              acSubmissionNum { difficulty count }
            }
            profile { ranking reputation }
            submissionCalendar
          }
        }
      `,
      variables: { username },
    }),
  });

  const data = await response.json().catch(() => null);
  const user = data && data.data && data.data.matchedUser;
  if (!response.ok || !user) {
    throw new SocialProfileNotFoundError(`No LeetCode user "${username}"`);
  }

  const byDifficulty = Object.fromEntries((user.submitStats?.acSubmissionNum || []).map((d) => [d.difficulty, d.count]));

  // submissionCalendar is a JSON-encoded string (unix-seconds -> count),
  // not a nested GraphQL object — LeetCode's own quirk, not ours.
  let calendar;
  try {
    calendar = JSON.parse(user.submissionCalendar || '{}');
  } catch {
    calendar = {};
  }
  const submissionCalendar = Object.entries(calendar).map(([timestamp, count]) => ({
    date: new Date(Number(timestamp) * 1000).toISOString().slice(0, 10),
    count: Number(count),
  }));

  return {
    ranking: user.profile?.ranking ?? null,
    reputation: user.profile?.reputation ?? null,
    totalSolved: byDifficulty.All ?? 0,
    easySolved: byDifficulty.Easy ?? 0,
    mediumSolved: byDifficulty.Medium ?? 0,
    hardSolved: byDifficulty.Hard ?? 0,
    submissionCalendar,
  };
}

module.exports = {
  verifyLeetcodeUsername,
  verifyHackerrankUsername,
  verifyDribbbleUsername,
  fetchLeetcodeStats,
  fetchHackerrankStats,
  SocialProfileNotFoundError,
};
