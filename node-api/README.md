# Skillovate Node API

Clean-architecture REST backend (Node.js/Express) backed by Google Cloud SQL for PostgreSQL.
Lives in its own folder (`node-api/`) as an independent deployable — see [`REQUIREMENTS.md`](REQUIREMENTS.md)
for prerequisites and [`../README.md`](../README.md) for how this fits alongside the Python service.

## Quick start

```bash
cd node-api
npm install
cp .env.node.example .env.node   # fill in real DB/JWT/Google values
psql "$DATABASE_URL" -f sql/schema.sql   # or gcloud sql connect ... < sql/schema.sql
npm run db:test                  # verifies DB connectivity + schema
npm run dev                      # http://localhost:5000
```

## Architecture (`src/`)

```
src/
  config/        env.js, database.js (pg Pool), constants.js (roles)
  controllers/    HTTP request/response handlers only — no SQL, no business rules
  services/       business logic; BaseService gives every entity list/get/create/update/remove
  repositories/   the only layer that runs SQL; BaseRepository gives generic parameterized CRUD
  routes/         Express routers — wire authenticate/authorize/validate per endpoint
  middlewares/    authenticate (JWT), authorize (RBAC), scopeInstitution (multi-tenant), validate (Joi), rateLimiter, errorHandler
  models/         table name + column whitelist per entity (used by repositories, not an ORM)
  utils/          jwt, password hashing, Google OAuth verification, ApiError/ApiResponse, logger
  validations/    Joi schemas per module
```

Request flow: `route → middlewares (auth/RBAC/validation) → controller → service → repository → pg pool`.

## Security

Helmet, strict CORS allowlist, global + auth-specific rate limiting, Joi input validation on every
write endpoint, parameterized SQL everywhere (no string-built queries), bcrypt password hashing,
JWT access + refresh tokens, Google ID token verification, and RBAC enforced per-route plus
institution-level row scoping in the service layer.

## Roles

`super_admin` → `institution_admin` → `hr` / `faculty` → `student`. See `docs/API.md` for the
full per-endpoint role matrix.

## Docs

- [`docs/API.md`](docs/API.md) — endpoint reference
- [`docs/FRONTEND_INTEGRATION.md`](docs/FRONTEND_INTEGRATION.md) — Axios client + CORS setup for the frontend
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Cloud Run + Cloud SQL deployment, scaling notes
- [`sql/schema.sql`](sql/schema.sql) — full PostgreSQL schema (16 tables, PK/FK/indexes/constraints)
