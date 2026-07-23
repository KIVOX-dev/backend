# Node API — Requirements & Prerequisites

| Requirement | Version / Notes |
|---|---|
| Node.js | >= 18 |
| Dependencies | `package.json` (npm) — `npm install` (run from inside `node-api/`) |
| Database | PostgreSQL 15+ (Google Cloud SQL in production) — see `sql/schema.sql` |
| Config | `.env.node` (copy from `.env.node.example`) |
| Run | `npm run dev` (nodemon) or `npm start` |
| Schema | `psql "$DATABASE_URL" -f sql/schema.sql` — run once against a fresh database |
| Connection check | `npm run db:test` |
| Docker | `Dockerfile` — build context is this folder: `docker build -f Dockerfile .` from inside `node-api/` |

## Required env vars (`.env.node`)

`DATABASE_URL` or `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`, `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PORT`, `CORS_ORIGINS`.
Full list with defaults: `.env.node.example`.
