# Deployment — Google Cloud

Two independent deployables: the Node API (`node-api/`, this folder) and the frontend
(deployed separately, wherever it already lives). They talk to each other over HTTPS/REST only.

All commands below assume your working directory is `node-api/` (i.e. `cd node-api` first).

## 1. Provision Cloud SQL for PostgreSQL

```bash
gcloud sql instances create skillovate-pg \
  --database-version=POSTGRES_15 \
  --tier=db-custom-2-7680 \
  --region=asia-south1 \
  --storage-auto-increase \
  --backup-start-time=02:00

gcloud sql databases create skillovate --instance=skillovate-pg
gcloud sql users create skillovate --instance=skillovate-pg --password='<strong-password>'

# Apply the schema once
gcloud sql connect skillovate-pg --user=skillovate --database=skillovate < sql/schema.sql
```

Cloud SQL enforces encrypted connections for any client connecting over its public/private IP;
connections made through the Cloud SQL Auth Proxy or the Cloud Run built-in Unix-socket
integration (below) are encrypted automatically without extra config.

## 2. Build & push the backend image

```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/skillovate-api -f Dockerfile
```

## 3. Store secrets

Never bake secrets into the image or commit `.env.node`. Use Secret Manager:

```bash
printf '%s' '<value>' | gcloud secrets create JWT_SECRET --data-file=-
printf '%s' '<value>' | gcloud secrets create JWT_REFRESH_SECRET --data-file=-
printf '%s' '<value>' | gcloud secrets create DB_PASSWORD --data-file=-
printf '%s' '<value>' | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-
```

## 4. Deploy to Cloud Run, wired to Cloud SQL

```bash
gcloud run deploy skillovate-api \
  --image gcr.io/PROJECT_ID/skillovate-api \
  --region asia-south1 \
  --platform managed \
  --add-cloudsql-instances PROJECT_ID:asia-south1:skillovate-pg \
  --set-env-vars NODE_ENV=production,PORT=8080,API_PREFIX=/api/v1 \
  --set-env-vars DB_HOST=/cloudsql/PROJECT_ID:asia-south1:skillovate-pg,DB_NAME=skillovate,DB_USER=skillovate \
  --set-env-vars CORS_ORIGINS=https://your-frontend.example.com \
  --set-env-vars GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com \
  --set-secrets DB_PASSWORD=DB_PASSWORD:latest,JWT_SECRET=JWT_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest \
  --min-instances 1 \
  --max-instances 20 \
  --concurrency 80 \
  --allow-unauthenticated
```

Notes:
- `--add-cloudsql-instances` mounts the Cloud SQL Auth Proxy as a Unix domain socket at
  `/cloudsql/INSTANCE_CONNECTION_NAME` inside the container — that's exactly the `DB_HOST` value
  `src/config/database.js` expects; no `DATABASE_URL`/TCP/SSL config needed in this mode.
  `PORT` is supplied by Cloud Run itself (defaults to 8080) and read by `src/config/env.js`.
- `--allow-unauthenticated` exposes the API publicly (it does its own JWT/RBAC auth). Remove it
  and use IAM-based invoker permissions instead if the API should sit behind additional network
  auth (e.g. only callable from an API Gateway).

## 5. Scaling to 100k+ users

- **Statelessness**: JWT auth means any Cloud Run instance can serve any request — no sticky
  sessions, so Cloud Run can scale horizontally (`--max-instances`) without a shared session store.
- **Connection pooling**: each instance holds its own `pg` pool (`DB_POOL_MAX`, default 20). Size
  it against Cloud SQL's `max_connections` divided by the instance count you expect at peak
  (`max-instances * DB_POOL_MAX <= max_connections`, leaving headroom). For very high concurrency,
  put **PgBouncer** or **Cloud SQL's built-in connection pooling** in front of Postgres instead of
  raising `max_connections` indefinitely.
- **Indexes**: every foreign key and every filter used by `scopeInstitution`/list endpoints already
  has an index (see `sql/schema.sql`) — this is what keeps list queries fast as row counts grow.
- **Read scaling**: for read-heavy load (dashboards, leaderboards), add a Cloud SQL read replica
  and point read-only repository queries at it; writes stay on the primary.
- **Rate limiting**: `express-rate-limit` protects a single instance; behind Cloud Run's autoscaling
  this is per-instance, not global — for a hard global cap, move rate limiting to Cloud Armor or an
  API Gateway in front of Cloud Run.

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
