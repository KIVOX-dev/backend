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
