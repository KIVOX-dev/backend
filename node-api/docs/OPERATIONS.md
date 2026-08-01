# Operations Guide

Covers what isn't already in `DEPLOYMENT.md` (provisioning/deploy steps) or `CREDENTIAL_ROTATION.md`
(credential rotation): the WebSocket auth migration, rate-limiting architecture, monitoring,
troubleshooting, and rollback.

## WebSocket authentication migration

The chat WebSocket (`GET /api/v1/chat/ws`) authenticates via a token passed as a **WS subprotocol**
(`new WebSocket(url, [token])`, arrives server-side as the `Sec-WebSocket-Protocol` header) rather
than a `?token=` query string. Query strings end up in server access logs, browser history, and any
`Referer` header the page sends afterward — subprotocols don't.

The old query-string path is still accepted as a fallback (`chatServer.js#authenticate` checks the
subprotocol first, falls back to `?token=` only if absent) and every use of the fallback is logged:

```json
{"level":"warn","message":"WebSocket: legacy ?token= query-string auth used","userAgent":"...","origin":"..."}
```

**Migration phases** (this repo is currently at the end of Phase 1 — the frontend switch and
server-side logging are both done; Phases 2–3 are future work, not yet scheduled):

1. **Phase 1 (done)** — server accepts both, prefers subprotocol, logs every fallback use. Frontend
   (`useReconnectingSocket.ts`) already sends the subprotocol exclusively.
2. **Phase 2 (not started)** — once Phase 1's logs show the fallback is unused in production for a
   full deploy cycle (confirms no external client, mobile app, or forgotten cached frontend bundle
   still depends on `?token=`), start actively surfacing a deprecation warning to any client that
   still hits it (e.g. include a `Deprecation` response header on the handshake, or a
   `{type:"deprecation_warning"}` app-level message right after connecting).
3. **Phase 3 (not started)** — remove the `?token=` parsing branch from `authenticate()` entirely.
   Update this doc and `chatServer.js`'s comments accordingly.

Do not skip straight to Phase 3 without confirming Phase 1's logs are actually clean — that log
line is the only signal that anything still depends on the old path.

## Rate limiting architecture

`middlewares/rateLimiter.js` exports the same three limiters (`apiLimiter`, `authLimiter`,
`identifyLimiter`) as before — call sites (`route.use(apiLimiter)` etc.) never changed. What backs
them did: `middlewares/rateLimitStore.js`'s `HybridRateLimitStore` uses Redis
(`config/redis.js#getRedisClient`) when `REDIS_URL` is set and currently reachable, and an
in-process `Map` otherwise — checked on every single increment, not cached, so it self-heals the
moment Redis reconnects without any separate health-polling loop.

- **Single instance, no `REDIS_URL`**: in-memory counting, same behavior as before this work.
- **Multiple instances, `REDIS_URL` set**: limits are enforced globally (a client hitting instance A
  then instance B still shares one counter).
- **Multiple instances, Redis temporarily down**: each instance falls back to counting
  independently for the duration of the outage — looser than the intended global limit (a client
  could get `max * instance_count` requests through instead of `max`), but never zero protection,
  and never a failed/hung request waiting on a wedged Redis (`maxRetriesPerRequest: 1` in
  `config/redis.js` bounds that).

Health/readiness/metrics endpoints (`GET /health`, `/health/live`, `/health/ready`,
`/health/metrics`) are registered **before** `apiLimiter` in `app.js` specifically so load
balancer/orchestrator probes never compete with real traffic for the same budget — verified by
load-testing `/health` directly; it returned HTTP 429 under sustained load before this ordering fix.

## Monitoring guide

- **Correlation IDs**: every request gets an `X-Request-Id` (inbound value honored if the caller —
  e.g. a load balancer — already set one; generated otherwise) via `middlewares/requestId.js`,
  echoed back as a response header and included in every structured log line for that request.
  Use it to trace one request across logs when investigating an issue a user reports.
- **Structured request logs**: `middlewares/requestLogger.js` emits one JSON line per completed
  request (`{requestId, method, path, statusCode, durationMs, userId, role}`) — distinct from
  morgan's human-readable access log (still present, for local dev console reading). Feed this into
  whatever log aggregator you have for latency percentiles / error-rate dashboards; morgan's text
  format isn't reliably parseable for that.
- **`GET /health/metrics`**: uptime, memory (RSS/heap), local WebSocket connection count, Redis
  configured/ready state. Plain JSON, not a Prometheus text-format exporter — no `prom-client`
  dependency was added. WebSocket counts are *local to whichever instance answers the request*, not
  a cluster-wide total (see DEPLOYMENT.md §8) — aggregate across instances at the infra layer if
  the cluster-wide number matters.
- **What to alert on**: `/health/ready` returning 503 (Mongo unreachable — this is the one that
  should page someone), `/health/metrics`'s `redis.configured: true, redis.ready: false` persisting
  for more than a few minutes (degraded mode, not down, but worth knowing about), and a sustained
  rise in `statusCode >= 500` in the structured request logs.

## Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| Container exits immediately on startup | Missing `JWT_SECRET`/`JWT_REFRESH_SECRET`/`MONGODB_URI` — `config/env.js` throws synchronously if any are unset | Startup log's last line before exit |
| Container starts then crashes on first real request | Filesystem permission issue (e.g. the `uploads/profile` directory ownership bug fixed in this pass — see `Dockerfile`) | `docker logs <container>` for an `EACCES`/`ENOENT` stack trace |
| `/health` returns 200 but `/health/ready` returns 503 | Mongo unreachable — network/firewall/Atlas maintenance/wrong `MONGODB_URI` | `checks.mongo.status` in the `/health/ready` response (the actual driver error is logged server-side, not returned in the response — see the security note below) |
| Rate limiting seems inconsistent across requests to "the same" limit | Multiple instances without `REDIS_URL` set — each is counting independently | `/health/metrics`'s `redis.configured` |
| A user reports "logged out unexpectedly" right after an admin action | Expected if they changed their password or an admin reset it — both bump `token_version`, invalidating outstanding refresh tokens (see `auth.service.js`) | Not a bug; confirm via `recordActivity` log for that user |
| WebSocket messages not arriving between two users | If multi-instance: confirm `REDIS_URL` is set on **every** instance, not just some | `/health/metrics`'s `redis.ready` on each instance; server logs for "Chat broadcaster: Redis-backed" vs "in-memory" at startup |

**Security note on `/health/ready`**: it deliberately never echoes a raw driver error message in
its response (both Mongo and Redis failures are logged server-side with `logger.error`/`warn` and
reported to the client as just `{"status":"error"}`) — this endpoint is unauthenticated by design
(load balancer probe), so it follows the same discipline as `errorHandler.js`: never leak internal
error detail to an unauthenticated caller.

## Disaster recovery / rollback

- **Bad deploy**: Cloud Run (or equivalent) keeps prior revisions — route traffic back to the last
  known-good revision. This service is fully stateless (JWT auth, no server-side session store), so
  rolling back is safe at any time with no session-migration concern.
- **Bad Redis rotation/outage**: no rollback needed — every Redis-backed feature already falls back
  to single-instance behavior automatically (see "Rate limiting architecture" above and
  `websocket/broadcaster.js`). Fix Redis when convenient; nothing is on fire in the meantime.
- **Bad credential rotation**: see `CREDENTIAL_ROTATION.md`'s own rollback section.
- **Database issue**: MongoDB Atlas handles its own replication/backups (point-in-time restore via
  Atlas's own tooling) — this app has no bespoke backup/restore scripts of its own to run.
- **General principle**: because there's no server-side session state, "roll back the deployment"
  and "roll back the database" are independent operations — you never need to coordinate the two.
