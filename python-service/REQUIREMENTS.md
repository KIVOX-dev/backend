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

`seed_mongo.py` contains a hardcoded plaintext MongoDB Atlas password. Rotate that credential and
load it from `.env`/Secret Manager instead before relying on this script outside a local machine.
