# UpScaler-AI Node API

Clean-architecture REST backend (Node.js/Express) backed by MongoDB.
Lives in its own folder (`node-api/`) as an independent deployable — see [`REQUIREMENTS.md`](REQUIREMENTS.md)
for prerequisites and [`../README.md`](../README.md) for how this fits alongside the Python service.

## Quick start

```bash
cd node-api
npm install
cp .env.node.example .env.node   # fill in real MONGODB_URI/JWT/Google values
npm run db:test                  # verifies DB connectivity
npm run db:setup-indexes         # creates all collections' indexes (idempotent)
npm run dev                      # http://localhost:5000
```

## Architecture (`src/`)

```
src/
  config/        env.js, database.js (MongoClient), constants.js (roles)
  controllers/    HTTP request/response handlers only — no DB access, no business rules
  services/       business logic; BaseService gives every entity list/get/create/update/remove
  repositories/   the only layer that talks to MongoDB; BaseRepository gives generic CRUD
                  over a collection, with a whitelist of writable fields per entity
  routes/         Express routers — wire authenticate/authorize/validate per endpoint
  middlewares/    authenticate (JWT), authorize (RBAC), scopeInstitution (multi-tenant), validate (Joi), rateLimiter, errorHandler
  models/         collection name + field whitelist per entity (used by repositories, not an ODM)
  utils/          jwt, password hashing, Google OAuth verification, ApiError/ApiResponse, logger
  validations/    Joi schemas per module
```

Request flow: `route → middlewares (auth/RBAC/validation) → controller → service → repository → MongoDB`.

Every document uses an app-generated UUID string as `_id` (not Mongo's default ObjectId) —
that's what lets JWT payloads, Joi `.uuid()` validation, and cross-entity references (e.g.
`student_id` on a placement application) stay simple strings throughout the codebase.

## Data model notes (MongoDB vs. the old Postgres schema)

MongoDB has no foreign keys, CHECK constraints, or native ENUM types, so a few things that used
to be enforced by the database now live in application code instead:
- **Referential integrity** (e.g. a result must reference a real test assignment) is checked in
  the relevant service before writing — see `src/services/result.service.js` for an example.
- **Valid enum values** (roles, statuses, etc.) are enforced by Joi at the API boundary
  (`src/validations/*.js`), not by storage.
- **Uniqueness** (email, institution code, etc.) is enforced by MongoDB unique indexes, created
  via `scripts/setupIndexes.js` (the Mongo equivalent of the old `sql/schema.sql`).
- **Cascading deletes** (e.g. deleting an institution used to cascade to its departments/students)
  are *not* automatically replicated — deleting a parent document currently leaves child documents
  in place. Add explicit cleanup in the relevant service if you need that behavior.

## Security

Helmet, strict CORS allowlist, global + auth-specific rate limiting, Joi input validation on every
write endpoint, a fixed field whitelist per entity (no mass-assignment), bcrypt password hashing,
JWT access + refresh tokens, Google ID token verification, and RBAC enforced per-route plus
institution-level row scoping in the service layer.

## Roles

`super_admin` → `institution_admin` → `hr` / `faculty` → `student`. See `docs/API.md` for the
full per-endpoint role matrix.

## Docs

- [`docs/API.md`](docs/API.md) — endpoint reference
- [`docs/FRONTEND_INTEGRATION.md`](docs/FRONTEND_INTEGRATION.md) — Axios client + CORS setup for the frontend
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Cloud Run + MongoDB Atlas deployment, scaling, Redis setup
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — WebSocket auth migration, rate-limiting architecture, monitoring, troubleshooting, rollback
- [`docs/CREDENTIAL_ROTATION.md`](docs/CREDENTIAL_ROTATION.md) — credential rotation checklist
- [`scripts/setupIndexes.js`](scripts/setupIndexes.js) — full index plan (16 collections, uniqueness + query indexes)
