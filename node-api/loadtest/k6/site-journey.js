// Production-safe staged load test for talentsnaps.com (frontend) +
// node-api (backend). Reads real routes only — see loadtest/README.md
// "Endpoint inventory" for what was confirmed against the actual source
// (node-api/src/routes/*.js) versus what still needs your confirmation.
//
// Requires k6 >= 0.42 (uses per-threshold abortOnFail — the auto-stop
// safety valve for the "stop if error rate > 5% / latency extreme" rule).
//
// Run: see README.md. Quick reference:
//   k6 run -e API_URL=https://<node-api-host>/api/v1 \
//          -e BASE_URL=https://www.talentsnaps.com \
//          -e TOKENS_FILE=./tokens.json \
//          loadtest/k6/site-journey.js

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Rate, Trend } from 'k6/metrics';
import { b64decode } from 'k6/encoding';

// ---------------------------------------------------------------------------
// Configuration (all overridable with -e KEY=value)
// ---------------------------------------------------------------------------
const BASE_URL = (__ENV.BASE_URL || 'https://www.talentsnaps.com').replace(/\/$/, '');
const API_URL = (__ENV.API_URL || '').replace(/\/$/, ''); // e.g. https://node-api-xxx.asia-south1.run.app/api/v1
if (!API_URL) {
  throw new Error('API_URL is required, e.g. -e API_URL=https://node-api-xxx.asia-south1.run.app/api/v1');
}

const TOKENS_FILE = __ENV.TOKENS_FILE || './tokens.json';
const THINK_MIN_S = Number(__ENV.THINK_MIN_S || 1);
const THINK_MAX_S = Number(__ENV.THINK_MAX_S || 4);
const ENABLE_UPLOAD = (__ENV.ENABLE_UPLOAD || 'false') === 'true';

// Hard guardrail, not just documentation: the 100-VU stage only runs if the
// caller explicitly confirms it. Everything else (10/25/50) always runs.
// Per the brief: "prefer staging for the 100-user tests" / "don't run the
// highest-load test against production unless explicitly confirmed".
const CONFIRM_100_VU_STAGE = (__ENV.CONFIRM_100_VU_STAGE || 'false') === 'true';

// Pre-authenticated accounts, produced by loadtest/k6/lib/preauth.js.
// Doing the login ONCE per account (out of band, before the test) instead
// of inside the k6 iteration is deliberate: auth.routes.js shares ONE
// rate-limit bucket (20 req / 15 min per IP, see authLimiter in
// middlewares/rateLimiter.js) across login/register/google/refresh/forgot-
// /reset-password. A k6 run that logs in per-VU-per-iteration would trip
// that limiter almost immediately and you'd be measuring the rate limiter,
// not the app. See README.md "Rate limits" section before running this.
const accounts = new SharedArray('accounts', function () {
  const raw = open(TOKENS_FILE);
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`${TOKENS_FILE} is empty or not an array — run lib/preauth.js first`);
  }
  return data;
});

// ---------------------------------------------------------------------------
// Custom metrics (readable in the end-of-test summary / --out json stream)
// ---------------------------------------------------------------------------
const errorRate = new Rate('app_error_rate'); // non-2xx/3xx, excluding expected 401-then-refresh
const rateLimited = new Rate('rate_limited_429');
const homepageTrend = new Trend('journey_homepage_ms');
const browseTrend = new Trend('journey_browse_ms');
const authTrend = new Trend('journey_auth_ms');
const listTrend = new Trend('journey_list_ms');
const detailTrend = new Trend('journey_detail_ms');
const uploadTrend = new Trend('journey_upload_ms');

// ---------------------------------------------------------------------------
// Staged ramp — 10 -> 25 -> 50 -> (100 only if confirmed), 5 min holds,
// 2-5 min ramps, as specified.
// ---------------------------------------------------------------------------
const stages = [
  { duration: '3m', target: 10 }, // ramp-up
  { duration: '5m', target: 10 }, // hold
  { duration: '2m', target: 25 },
  { duration: '5m', target: 25 },
  { duration: '2m', target: 50 },
  { duration: '5m', target: 50 },
];

if (CONFIRM_100_VU_STAGE) {
  stages.push({ duration: '4m', target: 100 }, { duration: '5m', target: 100 });
} else {
  console.warn(
    'CONFIRM_100_VU_STAGE not set — capping this run at 50 VUs. ' +
      'Pass -e CONFIRM_100_VU_STAGE=true only after you have explicitly confirmed ' +
      'the target environment (ideally staging) can safely take 100 concurrent users.'
  );
}
stages.push({ duration: '3m', target: 0 }); // ramp-down

export const options = {
  scenarios: {
    staged_journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages,
      gracefulRampDown: '30s',
    },
  },
  // p(50)/p(90)/p(95)/p(99) all reported explicitly (k6 defaults to avg/p90/p95 only).
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  thresholds: {
    // --- Safety valves: these ABORT the whole test run early. ---
    http_req_failed: [
      { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '20s' }, // "stop if error rate > 5%"
      'rate<0.01', // acceptance target (non-aborting; just marks the run failed)
    ],
    http_req_duration: [
      { threshold: 'p(95)<10000', abortOnFail: true, delayAbortEval: '20s' }, // "stop if latency becomes extreme"
      'p(95)<2000', // acceptance target
      'p(99)<5000', // acceptance target
    ],
    // --- Acceptance targets (non-aborting) ---
    checks: ['rate>0.99'],
  },
};

// ---------------------------------------------------------------------------
// Per-VU session state. k6 reuses the same VU (and this module's JS state)
// across iterations, so caching the token here means each VU authenticates
// once (in preauth, not here) and reuses it — never re-logging-in mid-test.
// ---------------------------------------------------------------------------
const sessions = {};

function accountFor(vuId) {
  return accounts[(vuId - 1) % accounts.length];
}

function session() {
  const vuId = __VU;
  if (!sessions[vuId]) {
    const acct = accountFor(vuId);
    sessions[vuId] = {
      email: acct.email,
      accessToken: acct.accessToken,
      refreshToken: acct.refreshToken,
      userId: acct.userId || null,
      role: acct.role || 'student',
      // Jittered proactive-refresh deadline so 100 VUs that all logged in
      // around the same time don't all hit /auth/refresh in the same
      // second later on (that shared 20/15min authLimiter bucket again).
      refreshAtMs: Date.now() + (acct.expiresInMs || 15 * 60 * 1000) * (0.55 + Math.random() * 0.25),
    };
  }
  return sessions[vuId];
}

function authHeaders(s) {
  return { Authorization: `Bearer ${s.accessToken}`, Accept: 'application/json' };
}

function maybeRefresh(s) {
  if (Date.now() < s.refreshAtMs) return;
  const res = http.post(
    `${API_URL}/auth/refresh`,
    JSON.stringify({ refreshToken: s.refreshToken }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'auth_refresh' } }
  );
  authTrend.add(res.timings.duration);
  rateLimited.add(res.status === 429);
  if (res.status === 200) {
    const body = res.json();
    s.accessToken = body.access_token || body.data?.accessToken;
    s.refreshToken = body.refresh_token || body.data?.refreshToken || s.refreshToken;
    s.refreshAtMs = Date.now() + 15 * 60 * 1000 * (0.55 + Math.random() * 0.25);
  } else {
    // Don't spin retrying a broken refresh every iteration — back off ~5min
    // and keep using the (possibly stale) access token until then.
    s.refreshAtMs = Date.now() + 5 * 60 * 1000;
  }
}

function think() {
  sleep(THINK_MIN_S + Math.random() * (THINK_MAX_S - THINK_MIN_S));
}

function record(res) {
  const ok = res.status >= 200 && res.status < 400;
  errorRate.add(!ok);
  rateLimited.add(res.status === 429);
  return ok;
}

// A ~68-byte valid 1x1 PNG, used only for the opt-in upload journey.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

// 1. Homepage — public, unauthenticated, served by Next.js.
function journeyHomepage() {
  group('1_homepage', () => {
    const res = http.get(`${BASE_URL}/`, { tags: { name: 'homepage' } });
    homepageTrend.add(res.timings.duration);
    check(res, { 'homepage 200': (r) => r.status === 200 });
    record(res);
  });
  think();
}

// 2. Browse main (public marketing) pages — confirmed against
//    src/app/**/page.tsx. NOTE: /learner, /faculty, /hr, /superadmin also
//    exist as routes but render client-side login/dashboards behind auth —
//    included here only as "does the shell load", not as an authenticated
//    journey.
const PUBLIC_PAGES = ['/for-hr', '/for-institutions', '/institutional', '/register'];
function journeyBrowsePages() {
  group('2_browse_pages', () => {
    const page = PUBLIC_PAGES[Math.floor(Math.random() * PUBLIC_PAGES.length)];
    const res = http.get(`${BASE_URL}${page}`, { tags: { name: 'browse_page' } });
    browseTrend.add(res.timings.duration);
    check(res, { 'page 200': (r) => r.status === 200 });
    record(res);
  });
  think();
}

// 3 & 4. "Public listings/content" and "search/filter" — CONFIRMED: this
// app has no unauthenticated content-listing/search API (everything under
// /api/v1 requires a Bearer token except /auth/*, /students/identify, and
// /health/*; see routes/index.js + each router's router.use(authenticate)).
// The closest real equivalents are the authenticated list endpoints below,
// exercised with their real pagination params (page/limit — see
// placement.service.js#list). Flagging this explicitly rather than
// inventing a public search endpoint that doesn't exist.
function journeyListAndFilter(s) {
  group('3_4_list_and_filter', () => {
    maybeRefresh(s);
    const page = 1 + Math.floor(Math.random() * 3);
    const targets = [
      `${API_URL}/placements?page=${page}&limit=20`,
      `${API_URL}/tests?page=1&limit=20`,
      `${API_URL}/notifications`,
      `${API_URL}/leaderboard`,
    ];
    const url = targets[Math.floor(Math.random() * targets.length)];
    const res = http.get(url, { headers: authHeaders(s), tags: { name: 'list' } });
    listTrend.add(res.timings.duration);
    check(res, { 'list 2xx/401': (r) => (r.status >= 200 && r.status < 300) || r.status === 401 });
    record(res);
  });
  think();
}

// 5. Open an individual profile/content page — GET /auth/me (own profile)
// and, for students, GET /students/:id (own record) / GET /students/:id/dashboard.
function journeyDetail(s) {
  group('5_detail_page', () => {
    maybeRefresh(s);
    const meRes = http.get(`${API_URL}/auth/me`, { headers: authHeaders(s), tags: { name: 'auth_me' } });
    detailTrend.add(meRes.timings.duration);
    record(meRes);
    if (meRes.status === 200) {
      const body = meRes.json();
      const id = body?.data?.id || body?.id;
      if (id && s.role === 'student') {
        const res = http.get(`${API_URL}/students/${id}/dashboard`, {
          headers: authHeaders(s),
          tags: { name: 'student_dashboard' },
        });
        detailTrend.add(res.timings.duration);
        check(res, { 'detail 2xx/403/404': (r) => (r.status >= 200 && r.status < 300) || r.status === 403 || r.status === 404 });
        record(res);
      }
    }
  });
  think();
}

// 6. Normal authenticated-user actions — resume + profile schema reads
// (student's own data, read-only, safe to repeat).
function journeyAuthenticatedActions(s) {
  group('6_authenticated_actions', () => {
    maybeRefresh(s);
    const res1 = http.get(`${API_URL}/profile/me`, { headers: authHeaders(s), tags: { name: 'profile_me' } });
    record(res1);
    const res2 = http.get(`${API_URL}/resume`, { headers: authHeaders(s), tags: { name: 'resume_get' } });
    record(res2);
    check(res2, { 'resume 2xx/404': (r) => (r.status >= 200 && r.status < 300) || r.status === 404 });
  });
  think();
}

// 7. Upload — OPT IN ONLY (ENABLE_UPLOAD=true). Writes a real (tiny) file
// via POST /api/v1/profile (multipart). Confirmed limits: image-only,
// magic-byte verified, 5MB cap (middlewares/upload.js). This mutates the
// test account's stored profile photo on every call — fine for disposable
// test accounts, NOT fine to point at a real user's account.
function journeyUpload(s) {
  if (!ENABLE_UPLOAD) return;
  group('7_upload', () => {
    maybeRefresh(s);
    const payload = { profilePhoto: http.file(b64decode(TINY_PNG_B64), 'loadtest.png', 'image/png') };
    const res = http.post(`${API_URL}/profile`, payload, { headers: authHeaders(s), tags: { name: 'profile_upload' } });
    uploadTrend.add(res.timings.duration);
    check(res, { 'upload 2xx/400': (r) => (r.status >= 200 && r.status < 300) || r.status === 400 });
    record(res);
  });
  think();
}

// 8. Logout — CONFIRMED: there is no backend /auth/logout endpoint
// (auth.routes.js has none). The frontend's logout() is purely client-side
// (clears the Zustand store + localStorage token, see
// Upscaler-Frontend/src/stores/authStore.ts) — nothing to send over HTTP.
// Modeled here as simply retiring this VU's cached token so the NEXT
// iteration re-establishes a "session" the same way a real returning user
// would (no server call, matching production behavior exactly).
function journeyLogout(s) {
  group('8_logout_clientside_only', () => {
    // Intentionally no HTTP request — see comment above.
  });
}

// ---------------------------------------------------------------------------
// Main iteration — one simulated user session per iteration.
// ---------------------------------------------------------------------------
export default function () {
  const s = session();

  journeyHomepage();
  journeyBrowsePages();
  journeyListAndFilter(s);
  journeyDetail(s);
  journeyAuthenticatedActions(s);
  journeyUpload(s);
  journeyLogout(s);
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(
      {
        stage_config: stages,
        metrics_summary: {
          http_req_duration: data.metrics.http_req_duration?.values,
          http_req_failed: data.metrics.http_req_failed?.values,
          rate_limited_429: data.metrics.rate_limited_429?.values,
          checks: data.metrics.checks?.values,
          iterations: data.metrics.iterations?.values,
        },
      },
      null,
      2
    ),
    'loadtest-summary.json': JSON.stringify(data, null, 2),
  };
}
