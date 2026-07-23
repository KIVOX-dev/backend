# Skillovate Python Service

Existing FastAPI backend (Skillovate V2), using MongoDB as the primary datastore with a SQLite
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

This script contains a **hardcoded, plaintext MongoDB Atlas connection string with credentials**.
Treat that connection string as compromised (rotate the password in Atlas) and move real
credentials into `.env`/Secret Manager before this script is used anywhere beyond a local machine.
