# UpScaler-AI Python Service

Existing FastAPI backend (UpScaler-AI V2), using MongoDB as the primary datastore with a SQLite
fallback (`app/database.py`, `app/mongodb.py`). Lives in its own folder (`python-service/`) as an
independent deployable from the Node API — see [`REQUIREMENTS.md`](REQUIREMENTS.md) for
prerequisites and [`../README.md`](../README.md) for how this fits alongside it.

## Quick start

```bash
cd python-service
python -m venv .venv && .venv\Scripts\activate   # Windows; use source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env   # fill in real values
uvicorn app.main:app --reload
```

## Structure (`app/`)

```
app/
  api/v1/         one router module per feature (auth, students, placements, tests, colleges, ...)
  core/           security, RBAC, middleware, exceptions, websocket manager
  models/         data models
  schemas/        Pydantic request/response schemas
  repositories/   data-access layer
  services/       business logic (auth_service, seed_service)
  config.py       settings (pydantic-settings, reads .env)
  database.py     SQLAlchemy/SQLite setup
  mongodb.py      MongoDB client (primary datastore)
  main.py         FastAPI app entrypoint — run via `uvicorn app.main:app`
```

## Note on `seed_mongo.py`

This script used to contain a **hardcoded, plaintext MongoDB Atlas connection string with
credentials**. It now reads `MONGODB_URI`/`SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` from the
environment (`.env`) and refuses to run without them. The previously-hardcoded credential has
been **rotated in the Atlas console** and the old database user is no longer valid. It still
appears in plaintext in this repo's git history (commits `0274160` and `a53a25d`) — since it's
now a dead credential that's a lower-urgency cleanup, but if the repo is ever shared or made
public, purge it from history (e.g. `git filter-repo`) rather than relying on rotation alone.
