# UpScaler-AI — AI Service

A narrow FastAPI microservice that owns every Groq-backed AI feature the platform uses:

- Interview question generation (`POST /v1/interview/generate-questions`)
- Resume ATS analysis, JD matching, AI-suggest, parsing, and improvement (`POST /v1/resume/*`)
- Assessment/quiz question generation (`POST /v1/assessment/generate-questions`)

## What this service is — and isn't

- It owns **no business data**. Students, placements, resumes, and auth all stay in `node-api` /
  MongoDB. This service is stateless except for an optional, best-effort `ai_service_logs`
  collection (observability only — see `app/db.py`) that nothing else reads.
- It is **never called directly by the frontend**. `node-api` is the only caller, over a
  JWT-authenticated internal API (see `app/security.py`) — every route requires a short-lived
  HS256 token signed with a shared secret only `node-api` holds
  (`utils/aiServiceClient.js` on that side). A browser has no way to reach this service or its
  Groq quota.
- It is **not** a restoration of the old `python-service/` that was removed from this repo in an
  earlier pass — that was a full duplicate backend (auth, students, placements, its own MongoDB
  database). This service is a deliberately small slice of one concern.
- Every route degrades gracefully when `GROQ_API_KEY` isn't set: interview/assessment generation
  fall back to a local placeholder, resume improvement returns the original text unchanged, and
  the four remaining resume routes (analyze/match-jd/suggest/parse) return a clear `503` rather
  than crashing. `node-api` never needs to know which case it got — see
  `resumeBuilder.service.js#translateAiServiceError` on that side for how it maps this service's
  responses back onto the exact error contract the frontend already handled before this service
  existed.

## Running locally

```bash
python -m venv .venv
.venv/Scripts/activate  # or source .venv/bin/activate on Linux/Mac
pip install -r requirements-dev.txt
cp .env.example .env    # fill in AI_SERVICE_SHARED_SECRET to match node-api's .env.node
uvicorn app.main:app --reload --port 8001
```

## Testing

```bash
pytest -v       # 32 tests — Groq calls are mocked via respx, nothing hits the real API
ruff check .
```

## Dependency locking

`requirements.txt` declares loose (`>=`) version ranges for readability; `requirements-lock.txt`
is the exact resolved set (`pip freeze`), generated from a **clean, production-only** virtualenv
(`requirements.txt` alone, never `requirements-dev.txt`) and is what `Dockerfile` actually installs
from — the same reproducibility discipline as node-api's `package-lock.json`. Regenerate it with:

```bash
python -m venv .venv-lock && .venv-lock/Scripts/pip install -r requirements.txt
.venv-lock/Scripts/pip freeze > requirements-lock.txt
rm -rf .venv-lock
```

## Known accepted risk

`pip-audit` flags `PYSEC-2026-1325` (a Minerva timing side-channel in `python-ecdsa`, pulled in
transitively by `python-jose`). This service only ever signs/verifies HS256 (HMAC) tokens — never
ECDSA — so the vulnerable code path is never exercised. Upstream has stated side-channel attacks
are out of scope for `python-ecdsa` with no planned fix. CI's `ai-audit` job ignores this specific
ID; everything else still fails the build.
