# Production-safe load test — talentsnaps.com / node-api

Tests real, source-confirmed endpoints only (see "Endpoint inventory" below).
Nothing here was invented — anything the codebase couldn't confirm is called
out explicitly with a "NEEDS CONFIRMATION" tag.

## 0. Before you run anything — read this

### 0.1 The shared auth rate limit is the binding constraint

`node-api/src/middlewares/rateLimiter.js` defines `authLimiter`: **20
requests / 15 minutes, per source IP**, shared across `/auth/login`,
`/register`, `/google`, `/refresh`, `/forgot-password`, `/reset-password`,
`/change-initial-password`, `/verify-email`. There's also a global
`apiLimiter`: **300 requests / 15 minutes per IP** across all of `/api/v1`.
Both are keyed by `req.ip` (Cloud Run's `trust proxy` is set, so this is
your load generator's real outbound IP).

A k6 run from one machine is one IP. If the script logged in per-VU or
per-iteration, you'd hit 429s almost immediately — you'd be measuring the
rate limiter, not the app. This is why the design here:

- Logs in **once per test account, before the test**, via `lib/preauth.js`, and
- The k6 script **never calls `/auth/login`** — it reuses cached tokens and
  only calls `/auth/refresh` occasionally, jittered per VU so 100 VUs don't
  refresh in the same second.

Even so, at 50-100 concurrent VUs the *general* `apiLimiter` (300 req/15min)
will likely bind too, well before you learn anything about real app
capacity. **You have two options, and need to pick one before running the
50/100-VU stages:**

**Option A (recommended) — temporarily raise the limits on the target Cloud
Run service, for the duration of the authorized test window only, then
revert.** This is a deliberate, owner-authorized reconfiguration of your own
infrastructure for a sanctioned test — not "bypassing" the control (the ask
was not to *evade* rate limiting/WAF, e.g. by rotating source IPs to dodge
it; adjusting your own server's configured ceiling for your own scheduled
test is the opposite of that).

```
# Before the test (raise ceilings):
gcloud run services update node-api --region=<REGION> \
  --update-env-vars="^;^RATE_LIMIT_MAX=20000;AUTH_RATE_LIMIT_MAX=2000"

# After the test (revert to defaults — omit the vars, or set back explicitly):
gcloud run services update node-api --region=<REGION> \
  --update-env-vars="^;^RATE_LIMIT_MAX=300;AUTH_RATE_LIMIT_MAX=20"
```

**Option B — leave limits as-is and accept the constraints:** `lib/preauth.js`
will pace logins under the 20/15min budget (slow — budget ~75+ minutes of
lead time for 100 accounts) and the 50/100-VU stages will almost certainly
show 429s as the dominant "error" once cumulative request volume crosses
~300/15min. That's expected, not a bug — don't misdiagnose it as a capacity
problem. If you want to keep the real limiter active as part of what's under
test, cap `MAX_VUS` lower (e.g. 25) where 300/15min is more survivable.

### 0.2 Staging vs. production

No staging Cloud Run service was found in `cloudbuild.yaml` — only single
`node-api` / `ai-service` deploys. **NEEDS CONFIRMATION: do you have a
separate staging deployment, or is `talentsnaps.com` → `node-api` the only
environment?** If it's the only one, the script's `CONFIRM_100_VU_STAGE`
gate (see below) defaults to off, so you must explicitly opt in to the
100-VU stage against it.

### 0.3 Dedicated test accounts — you must provision these

This session has no access to your MongoDB Atlas instance. Create N
dedicated, disposable accounts (student role is the most complete journey —
see inventory below) directly in the target environment's database or via
its own admin/institution-admin onboarding flow, then list them in
`accounts.json` (copy `accounts.example.json`). Do not use real user
accounts.

## 1. Endpoint inventory (confirmed against source)

| # | Journey | Method/Path | Auth | Source |
|---|---|---|---|---|
| 1 | Homepage | `GET /` (talentsnaps.com) | none | `Upscaler-Frontend/src/app/page.tsx` |
| 2 | Browse main pages | `GET /for-hr`, `/for-institutions`, `/institutional`, `/register` | none | `Upscaler-Frontend/src/app/**/page.tsx` |
| 3/4 | "Public listings" / "search-filter" | **No public listing/search API exists.** Closest real equivalent: `GET /api/v1/placements?page=&limit=`, `GET /api/v1/tests`, `GET /api/v1/notifications`, `GET /api/v1/leaderboard` | Bearer JWT | `node-api/src/routes/{placement,test,notification,leaderboard}.routes.js` — all behind `router.use(authenticate)` |
| 5 | Individual profile/content page | `GET /api/v1/auth/me`, `GET /api/v1/students/:id/dashboard` | Bearer JWT | `auth.routes.js`, `student.routes.js`, `dashboard.routes.js` |
| 6 | Normal authenticated actions | `GET /api/v1/profile/me`, `GET /api/v1/resume` | Bearer JWT | `profile.routes.js`, `resumeBuilder.routes.js` |
| 7 | Upload (opt-in only) | `POST /api/v1/profile` (multipart, field e.g. `profilePhoto`) | Bearer JWT | `profile.routes.js` + `middlewares/upload.js` — **image only (jpg/png/gif/webp), 5MB cap, magic-byte verified** |
| 8 | Logout | **No backend endpoint.** Frontend `logout()` is client-side only (clears Zustand store + localStorage) — see `Upscaler-Frontend/src/stores/authStore.ts`. Modeled as a no-op. | n/a | n/a |
| — | Auth (setup only, not in the k6 loop) | `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh` | — | `auth.routes.js` — see rate-limit note above |
| — | Health (optional, for correlating with app-side metrics) | `GET /health`, `/health/ready`, `/health/metrics` | none | `health.routes.js` — separate, generous limiter (300/min) |

Not tested here, and why:
- **HR/faculty/institution-admin/super-admin journeys** — real endpoints exist
  (`hr.routes.js`, `faculty.routes.js`, `collegeAdmin.routes.js`, etc.) but were
  out of scope for the "typical end-user" journeys listed in the brief. If you
  want these included, provide test accounts per role and I'll extend
  `site-journey.js` with role-specific groups (the pattern is already there).
- **CDN / object storage** — uploads are written to the Cloud Run container's
  local disk (`node-api/src/middlewares/upload.js`), not GCS/S3/a CDN. Nothing
  to measure here unless that's changed since.
- **Queue / background-job latency** — no job queue found in `node-api/src`
  (no Bull/BullMQ/pg-boss usage). If one exists elsewhere (e.g. in
  `ai-service`), flag it and I'll add a probe.
- **Database/cache internals** — k6 can't see these from outside. Use
  `GET /health/metrics` (memory/websocket counts, already built) plus your
  MongoDB Atlas metrics and (if `REDIS_URL` is set) its own metrics — see
  §5 below.

## 2. Install

```bash
# k6
# macOS:   brew install k6
# Windows: choco install k6   (or: winget install k6)
# Linux:   see https://k6.io/docs/get-started/installation/ — install from your distro's k6 repo, not the language's own package manager
k6 version   # confirm >= 0.42 (needed for per-threshold abortOnFail)
```

No extra dependencies for `lib/preauth.js` — it's plain Node (uses only
built-in `https`/`http`/`fs`).

## 3. Configure

```bash
cd node-api/loadtest/k6
cp accounts.example.json accounts.json
# edit accounts.json with real dedicated test-account credentials for the target environment
```

Environment variables the k6 script reads (`-e KEY=value`):

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `API_URL` | **yes** | — | Backend origin + prefix, e.g. `https://node-api-xxx.asia-south1.run.app/api/v1` |
| `BASE_URL` | no | `https://www.talentsnaps.com` | Frontend origin |
| `TOKENS_FILE` | no | `./tokens.json` | Output of `lib/preauth.js` |
| `THINK_MIN_S` / `THINK_MAX_S` | no | `1` / `4` | Pause range between actions, seconds |
| `ENABLE_UPLOAD` | no | `false` | Opt into the upload journey (mutates test accounts' profile photo) |
| `CONFIRM_100_VU_STAGE` | no | `false` | Opt into the 100-VU stage; without it the run caps at 50 VUs |

## 4. Run

```bash
# Step 1 — pre-authenticate the pool ONCE (see §0.1 for why this is separate)
node lib/preauth.js \
  --api https://node-api-xxx.asia-south1.run.app/api/v1 \
  --accounts ./accounts.json \
  --out ./tokens.json

# Step 2 — smoke check first, always (1 VU, ~1 min), before any staged run
k6 run -e API_URL=https://node-api-xxx.asia-south1.run.app/api/v1 \
        -e TOKENS_FILE=./tokens.json \
        --vus 1 --duration 1m \
        site-journey.js

# Step 3 — the staged run, capped at 50 VUs by default
k6 run -e API_URL=https://node-api-xxx.asia-south1.run.app/api/v1 \
        -e TOKENS_FILE=./tokens.json \
        site-journey.js

# Step 3b — only once staging (or explicit production sign-off) is confirmed:
k6 run -e API_URL=https://node-api-xxx.asia-south1.run.app/api/v1 \
        -e TOKENS_FILE=./tokens.json \
        -e CONFIRM_100_VU_STAGE=true \
        site-journey.js
```

Optional: stream time-series to a file for later graphing:
`k6 run --out json=results.ndjson ...` (each line is one metric sample —
pipe into Grafana k6 dashboards, or a quick `jq` aggregation).

## 5. Staged ramp scenario (as specified)

| Stage | Target VUs | Duration | Type |
|---|---|---|---|
| 1 | 10 | 3 min | ramp-up |
| 2 | 10 | 5 min | hold |
| 3 | 25 | 2 min | ramp-up |
| 4 | 25 | 5 min | hold |
| 5 | 50 | 2 min | ramp-up |
| 6 | 50 | 5 min | hold |
| 7† | 100 | 4 min | ramp-up |
| 8† | 100 | 5 min | hold |
| 9 | 0 | 3 min | ramp-down |

† only included when `CONFIRM_100_VU_STAGE=true` (see §0.2).

Total duration: ~25 min (50-VU cap) or ~34 min (with the 100-VU stage).

## 6. Auto-stop thresholds (fail AND abort the run)

Defined in `options.thresholds` in `site-journey.js`:

- **Error-rate circuit breaker**: `http_req_failed` rate `< 0.05`, `abortOnFail: true` — stops the whole run within ~20s of crossing 5% errors, per the brief's safety requirement.
- **Latency circuit breaker**: `http_req_duration p(95) < 10000ms`, `abortOnFail: true` — stops the run if p95 blows out to 10s+ (well past "slow" and into "unstable").
- **Acceptance targets** (fail the run's exit code, don't abort mid-run): `http_req_failed rate < 0.01`, `http_req_duration p(95) < 2000ms`, `p(99) < 5000ms`, `checks rate > 0.99`.

If the run aborts early, that itself is a finding — note which stage/VU
count it happened at.

## 7. Report format

`handleSummary()` in `site-journey.js` writes `loadtest-summary.json` (full
k6 summary object) and prints a condensed JSON block to stdout. Build your
final report as:

```
## Load test report — <date>, <environment>, <k6 version>

### Config
- Target: <API_URL> / <BASE_URL>
- Max VUs reached: <10|25|50|100>
- Aborted early? <yes/no — at what stage>

### Results by stage
| Stage (VUs) | RPS | p50 | p90 | p95 | p99 | Error rate | 429 rate |
|---|---|---|---|---|---|---|---|
| 10  | ... | ... | ... | ... | ... | ... | ... |
| 25  | ... | ... | ... | ... | ... | ... | ... |
| 50  | ... | ... | ... | ... | ... | ... | ... |
| 100 | ... | ... | ... | ... | ... | ... | ... |

(Per-stage numbers: re-run k6 with --out json and filter by timestamp
range per stage, or run each stage as a separate short k6 invocation if
you want cleaner per-stage isolation.)

### Acceptance targets
- [ ] p95 < 2s
- [ ] p99 < 5s
- [ ] HTTP error rate < 1%
- [ ] No unexpected 5xx
- [ ] No DB connection exhaustion (see Atlas metrics)
- [ ] No memory leak (see Cloud Run memory graph — should plateau, not climb)

### Resource utilization (out-of-band — k6 can't see these)
- Cloud Run (node-api): CPU %, memory %, instance count, concurrency — Cloud Console → Cloud Run → node-api → Metrics, for the test time window
- MongoDB Atlas: connections, ops/sec, CPU — Atlas → Metrics, same window
- `GET /health/metrics` samples taken during the run (heap/rss, websocket connection count)
- Redis (if `REDIS_URL` set): via your Redis provider's own dashboard
```

## 8. Diagnosing bottlenecks from the results

- **Errors are almost all 429, not 5xx** → you're hitting `apiLimiter`/`authLimiter`, not a real capacity limit. Revisit §0.1 before drawing capacity conclusions.
- **p95/p99 climb steadily as VUs increase, few errors** → likely CPU-bound Cloud Run instance(s) or Mongo query latency under concurrency. Check Cloud Run's CPU graph and instance count (is it autoscaling? what's `--concurrency` set to?) alongside Atlas's ops/sec and slow-query log.
- **Latency fine, but 5xx spikes at a specific VU count** → check Cloud Run logs for that time window first (`gcloud run services logs read node-api --region=<region>`); likely an unhandled exception or a downstream dependency (ai-service, Mongo, Redis) timing out. `AI_SERVICE_URL`-backed routes (resume analyze, interview generation) are a good first suspect since ai-service is a separate, smaller Cloud Run service with its own scaling.
- **Errors/latency keep degrading during a "hold" stage instead of stabilizing** → possible connection pool exhaustion (`mongo.poolMax` defaults to 20 per node-api instance — multiply by however many instances autoscale in) or a slow memory leak; watch the Cloud Run memory graph for a monotonic climb rather than a plateau.
- **First request of each stage is much slower than the rest** → Cloud Run cold starts as new instances spin up on the scale-out; check min-instances setting if this matters for real traffic patterns.
- **`/auth/refresh` calls cluster and spike together** → the per-VU jitter in `site-journey.js` should prevent this; if it still happens, check whether all pre-auth logins in `preauth.js` ran back-to-back with too short a delay (all tokens then expire in sync ~15 min later).
