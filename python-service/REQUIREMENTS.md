# Python Service — Requirements & Prerequisites

| Requirement | Version / Notes |
|---|---|
| Python | 3.12 (see `.python-version`) — 3.14 is not supported yet (pydantic-core build issue) |
| Dependencies | `requirements.txt` (pip) — `pip install -r requirements.txt` (run from inside `python-service/`) |
| Database | MongoDB (primary, `app/mongodb.py`) with a SQLite fallback (`app/database.py`) |
| Config | `.env` (copy from `.env.example`) |
| Run | `uvicorn app.main:app --reload` |
| Migrations | `alembic.ini` / `alembic upgrade head` (SQLAlchemy side only) |
| Docker | `Dockerfile` — build context is this folder: `docker build -f Dockerfile .` from inside `python-service/` |

## Security note

`seed_mongo.py` previously contained a hardcoded plaintext MongoDB Atlas password. That credential
has been rotated and the script now loads `MONGODB_URI` from `.env`/Secret Manager instead. The
old (now-invalid) credential still exists in this repo's git history — see `README.md` for the
affected commits and cleanup note.
