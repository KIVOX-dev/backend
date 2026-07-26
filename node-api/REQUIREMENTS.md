# Node API — Requirements & Prerequisites

| Requirement | Version / Notes |
|---|---|
| Node.js | >= 18 |
| Dependencies | `package.json` (npm) — `npm install` (run from inside `node-api/`) |
| Database | MongoDB 6+ (MongoDB Atlas in production) |
| Config | `.env.node` (copy from `.env.node.example`) |
| Run | `npm run dev` (nodemon) or `npm start` |
| Indexes | `npm run db:setup-indexes` — creates all collections' indexes (idempotent, safe to re-run) |
| Connection check | `npm run db:test` |
| Docker | `Dockerfile` — build context is this folder: `docker build -f Dockerfile .` from inside `node-api/` |

## Required env vars (`.env.node`)

`MONGODB_URI`, `MONGODB_DB_NAME` (keep this **different** from the Python service's database name
so the two services never share/collide on the same collections), `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PORT`, `CORS_ORIGINS`.
Full list with defaults: `.env.node.example`.
