# Python Service — Requirements & Prerequisites

| Requirement | Version / Notes |
|---|---|
| Python | 3.12 (see `.python-version`) — 3.14 is not supported yet (pydantic-core build issue) |
| Dependencies | `requirements.txt` (pip) — `pip install -r requirements.txt` (run from inside `python-service/`) |
| Database | MongoDB — the only database engine. Async client `app/mongodb.py` (Motor), sync client `app/mongodb_sync.py` (PyMongo); `app/database.py` exposes the `get_db` dependency |
| Config | `.env` (copy from `.env.example`) — `MONGODB_URI` and `JWT_SECRET_KEY` are required |
| Run | `uvicorn app.main:app --reload` |
| Migrations | None. MongoDB is schemaless; indexes are created idempotently at startup by `app/db_indexes.py`. (The former SQLAlchemy/Alembic setup has been removed — see `../SECURITY_AUDIT.md`.) |
| Lint / test | `pip install -r requirements-dev.txt` then `ruff check .` / `pytest` |
| Docker | `Dockerfile` — build context is this folder: `docker build -f Dockerfile .` from inside `python-service/` |

## Security note

`seed_mongo.py` previously contained a hardcoded plaintext MongoDB Atlas password. That credential
has been rotated and the script now loads `MONGODB_URI` from `.env`/Secret Manager instead. The
old (now-invalid) credential still exists in this repo's git history — see `README.md` for the
affected commits and cleanup note.
