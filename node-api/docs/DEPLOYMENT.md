# Deployment — Google Cloud

Two independent deployables: the Node API (`node-api/`, this folder) and the frontend
(deployed separately, wherever it already lives). They talk to each other over HTTPS/REST only.

All commands below assume your working directory is `node-api/` (i.e. `cd node-api` first).

## 1. Provision MongoDB (Atlas)

Use a MongoDB Atlas cluster (or any managed MongoDB). Create a database user, grab the
`mongodb+srv://` connection string, and use a **database name dedicated to this API**
(e.g. `upscaler_ai_node`) so it never shares collections with the Python service's database.

Under Atlas → Network Access, either allow Cloud Run's egress (0.0.0.0/0 with a strong DB user
password + Atlas's built-in TLS, simplest) or set up VPC/Private Endpoint peering for a locked-down
setup. Atlas connections are TLS-encrypted by default — no separate SSL config needed.

Once you have the connection string, create the collections' indexes once:

```bash
MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net" MONGODB_DB_NAME=upscaler_ai_node \
  node scripts/setupIndexes.js
```

## 2. Build & push the backend image

```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/upscaler-ai-api -f Dockerfile
```

## 3. Store secrets

Never bake secrets into the image or commit `.env.node`. Use Secret Manager:

```bash
printf '%s' '<value>' | gcloud secrets create JWT_SECRET --data-file=-
printf '%s' '<value>' | gcloud secrets create JWT_REFRESH_SECRET --data-file=-
printf '%s' '<value>' | gcloud secrets create MONGODB_URI --data-file=-
printf '%s' '<value>' | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-
```

## 4. Deploy to Cloud Run

```bash
gcloud run deploy upscaler-ai-api \
  --image gcr.io/PROJECT_ID/upscaler-ai-api \
  --region asia-south1 \
  --platform managed \
  --set-env-vars NODE_ENV=production,PORT=8080,API_PREFIX=/api/v1,MONGODB_DB_NAME=upscaler_ai_node \
  --set-env-vars CORS_ORIGINS=https://your-frontend.example.com \
  --set-env-vars GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com \
  --set-secrets MONGODB_URI=MONGODB_URI:latest,JWT_SECRET=JWT_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest \
  --min-instances 1 \
  --max-instances 20 \
  --concurrency 80 \
  --allow-unauthenticated
```

Notes:
- Unlike Cloud SQL, MongoDB Atlas needs no Cloud Run-side socket/proxy wiring — it's a plain
  `mongodb+srv://` connection string over TLS, so `MONGODB_URI` is the only connection secret needed.
  `PORT` is supplied by Cloud Run itself (defaults to 8080) and read by `src/config/env.js`.
- `--allow-unauthenticated` exposes the API publicly (it does its own JWT/RBAC auth). Remove it
  and use IAM-based invoker permissions instead if the API should sit behind additional network
  auth (e.g. only callable from an API Gateway).

## 5. Scaling to 100k+ users

- **Statelessness**: JWT auth means any Cloud Run instance can serve any request — no sticky
  sessions, so Cloud Run can scale horizontally (`--max-instances`) without a shared session store.
- **Connection pooling**: each instance holds its own MongoDB driver pool (`MONGO_POOL_MAX`,
  default 20). Atlas clusters have their own overall connection ceiling by tier — size
  `max-instances * MONGO_POOL_MAX` against that, same idea as Postgres `max_connections`.
- **Indexes**: every field used by `scopeInstitution`/list endpoints already has an index (see
  `scripts/setupIndexes.js`) — this is what keeps list queries fast as document counts grow.
- **Read scaling**: for read-heavy load (dashboards, leaderboards), use an Atlas read replica /
  secondary with `readPreference: 'secondaryPreferred'` for read-only repository queries; writes
  stay on the primary.
- **Rate limiting**: Redis-backed when `REDIS_URL` is set (shared counters across every instance —
  see §8 below); falls back to per-instance in-memory counting when it isn't, or during a Redis
  outage. Below a handful of instances the in-memory fallback is usually fine; once traffic is
  spread across many replicas, set `REDIS_URL` so the limit is enforced globally rather than
  `max * instance_count`.
- **WebSocket broadcasting**: same story — Redis pub/sub (`REDIS_URL` set) is required for a chat
  message to reach a user connected to a *different* instance than the sender. Single-instance
  deployments don't need this; anything with `--min-instances` > 1 does.

## 8. Redis (rate limiting + WebSocket broadcasting across instances)

Optional at low scale, required once `--max-instances` (or equivalent) is set above 1 and you
want rate limits and chat delivery to work correctly *across* instances rather than per-instance.

```bash
# Memorystore for Redis (GCP) — or any Redis 6+, including a self-hosted one behind VPC peering.
gcloud redis instances create upscaler-ai-redis \
  --size=1 --region=asia-south1 --redis-version=redis_7_0

# Cloud Run must be on the same VPC (via a Serverless VPC Access connector) to reach it —
# Memorystore has no public IP by design.
gcloud run deploy upscaler-ai-api \
  --vpc-connector YOUR_CONNECTOR \
  --set-env-vars REDIS_URL=redis://10.x.x.x:6379 \
  ...(other flags from §4)
```

Nothing else changes — `config/redis.js` picks up `REDIS_URL` automatically, and every
Redis-backed feature (rate limiting, chat broadcast) degrades to its single-instance behavior
if Redis is unreachable rather than failing requests. Verify after deploying:

```bash
curl https://your-service-url/health/ready
# {"status":"ready","checks":{"mongo":{"status":"ok",...},"redis":{"status":"ok","latencyMs":...}}}
```

## 9. Health, readiness, and metrics endpoints

All three are registered *before* the rate limiter (deliberately — see app.js) so load balancer /
orchestrator probes are never subject to the same request budget as real API traffic:

| Endpoint | Purpose | Checks |
|---|---|---|
| `GET /health`, `GET /health/live` | Liveness — is the process alive | Nothing downstream (never fails due to Mongo/Redis being down — that would cause a restart loop) |
| `GET /health/ready` | Readiness — can this instance serve traffic | Real Mongo ping (required); real Redis ping if `REDIS_URL` is set (informational only — never fails readiness) |
| `GET /health/metrics` | Plain JSON operational snapshot | Uptime, memory, local WebSocket connection count, Redis configured/ready state |

Point Cloud Run's liveness/startup probes (or Kubernetes' `livenessProbe`/`readinessProbe`) at
`/health/live` and `/health/ready` respectively.

## 6. Frontend deployment

The frontend is a separate deployable and isn't touched by this backend work. Typical options:
- Next.js app (`D:\Upscaler-Frontend`): Vercel, or `gcloud run deploy` with a Next.js
  standalone Docker build, or Firebase App Hosting.
- A Vite/React app: any static host (Firebase Hosting, Cloud Storage + Cloud CDN, Vercel, Netlify).

Whichever host you pick, set its `NEXT_PUBLIC_API_URL` / `VITE_API_URL` env var to the deployed
Cloud Run URL, and add that frontend's origin to the backend's `CORS_ORIGINS`.

## 7. Local development ports

| Service  | URL                     |
|----------|-------------------------|
| Frontend | http://localhost:5173   |
| Backend  | http://localhost:5000   |

`CORS_ORIGINS=http://localhost:5173` in `.env.node` covers local dev.
