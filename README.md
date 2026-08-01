# UpScaler-AI Backend

This repository hosts **two independent backend services**, each in its own folder with its own
dependency manifest, env files, and `Dockerfile`:

| Folder | Stack | Purpose |
|---|---|---|
| [`python-service/`](python-service/README.md) | Python 3.12 / FastAPI / MongoDB | The original UpScaler-AI V2 API |
| [`node-api/`](node-api/README.md) | Node.js / Express / MongoDB | Clean-architecture REST API, RBAC, JWT + Google OAuth |

Neither service's code was touched by the other's setup — see each folder's own `README.md` for
architecture and `REQUIREMENTS.md` for prerequisites.

## Recent updates

- **Added** the full Node/Express/PostgreSQL API (16-table schema, RBAC, JWT + Google OAuth,
  clean architecture, deployment docs) — originally scaffolded at the repo root.
- **Removed** ~19 stale one-off debug/migration scripts that had accumulated at the repo root
  (`fix_db*.py`, `migrate_to_mongo.py`, `sync_sqlite_to_mongo.py`, `query_db*.py`, `test_hash.py`,
  `change_admin_pass.py`, `check.py`, `test-login.js`, a `query.js` with a hardcoded DB password,
  an empty `skillovate.db`, and an unused `main.py` stub) and ~60 committed `__pycache__/*.pyc`
  files; added the right patterns to `.gitignore` so they don't return.
- **Reorganized** the repo root: what used to be a flat mix of Python and Node config files is now
  split into `python-service/` and `node-api/`, each self-contained. `Dockerfile.node` was renamed
  to plain `Dockerfile` inside `node-api/` (the `.node` extension was being misread as a compiled
  Node binary by some tooling, and the suffix was only there to avoid colliding with the Python
  service's `Dockerfile` when both sat in the same folder — no longer needed once separated).
- **Found and relocated** `seed_mongo.py` (created outside this cleanup, containing a hardcoded
  plaintext MongoDB Atlas password) into `python-service/` — **that credential should be rotated**;
  see the security note in `python-service/README.md`.
- **Swapped the Node API's database from PostgreSQL to MongoDB** — no live Postgres instance was
  ever provisioned, whereas the Python service's MongoDB Atlas connection was already proven
  working. `sql/schema.sql` was replaced by `node-api/scripts/setupIndexes.js` (creates the same
  uniqueness/query indexes without SQL). Both services now use MongoDB, but **on separate
  database names** (`upscaler_ai` for Python, `upscaler_ai_node` for Node) on the same cluster — they
  do not share collections, and each still owns its own connection string.
- **Standardized the Python service on MongoDB only.** It still carried a full SQLAlchemy layer
  (an ORM model package, `alembic.ini`, `sqlalchemy`/`alembic`/`psycopg` dependencies, a
  `DATABASE_URL` setting, and `Session`/`Query` type hints on functions that were actually being
  handed a Mongo handle) left over from the Postgres era. All of it was unreachable at runtime and
  has been removed — see [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) for the full inventory. The same
  pass found that the service's real drivers (`motor`, `pymongo`, `certifi`, `groq`) were never
  declared in `requirements.txt`, which meant the built Docker image crashed on startup.

## Local development ports

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 (or 3000 for the existing Next.js app) |
| Node API | http://localhost:5000 |
| Python service | http://localhost:8000 |
