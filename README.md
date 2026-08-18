# UpScaler-AI Backend

[![CI](https://github.com/KIVOX-dev/backend/actions/workflows/ci.yml/badge.svg)](https://github.com/KIVOX-dev/backend/actions/workflows/ci.yml)

UpScaler-AI is a placement and career-readiness platform: one system where students take tests
and mock interviews, build and improve resumes, and track placement applications, while faculty,
HR, and institution admins manage the pipeline behind them. This repository holds the two backend
services that run it.

| Service | Stack | Role |
|---|---|---|
| [`node-api/`](node-api/README.md) | Node.js, Express, MongoDB | The API. Every route the frontend calls — auth, RBAC, students, placements, chat — lives here. |
| [`ai-service/`](ai-service/README.md) | Python 3.12, FastAPI, MongoDB | A narrow internal microservice for Groq-backed AI features (interview questions, resume analysis). Called only by `node-api`, never by the frontend directly. |

`node-api` is the sole entry point for the frontend and the source of truth for business data.
`ai-service` owns none of that data itself and reaches the outside world only through a
JWT-authenticated internal API that `node-api` mints a fresh token for on every request.

## What it does

- **Institutions, departments, and people** — super admins, institution admins, college admins,
  HR, faculty, and students, each scoped to their own institution's data.
- **Tests and assessments** — test creation, assignment, AI-generated question banks, and results.
- **Mock interviews** — AI-generated interview questions per role/topic.
- **Resume builder** — ATS analysis, job-description matching, AI suggestions, parsing, and
  AI-assisted rewrites.
- **Placements** — company and job listings, applications, and status tracking end to end.
- **Notifications and chat** — in-app notifications and real-time chat over WebSockets, kept in
  sync across multiple API replicas via Redis.
- **Activity logs** — an audit trail of who did what, for admins and compliance.

See [`node-api/docs/API.md`](node-api/docs/API.md) for the full endpoint reference and the
per-route role matrix.

## Getting started

The fastest way to run the full stack — frontend, both backend services, MongoDB, and Redis — is
Docker Compose:

```bash
cp .env.compose.example .env    # fill in JWT_SECRET and JWT_REFRESH_SECRET; see comments inline
docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Node API | http://localhost:5000 |

To work on a single service instead — with hot reload and without Docker — see that service's own
README:

- [`node-api/README.md`](node-api/README.md) — architecture, quick start, API docs
- [`ai-service/README.md`](ai-service/README.md) — quick start, testing, deployment notes

Prerequisites for running services outside Docker (Node/Python versions, package managers) are
listed in [`REQUIREMENTS.md`](REQUIREMENTS.md). Frontend requirements live in the frontend's own
repository, `Upscaler-Frontend/REQUIREMENTS.md`.

## How the pieces fit together

```
Browser
  │
  ▼
Frontend (Next.js, :3000)
  │  NEXT_PUBLIC_API_URL
  ▼
node-api (:5000)  ──┬──▶  MongoDB   business data: users, students, placements, tests, chat
  │  internal JWT    ├──▶  Redis     shared rate limits + chat pub/sub across replicas
  ▼                  │
ai-service (:8001)  ─┘──▶  Groq API  question generation, resume analysis
```

`ai-service` is stateless aside from an optional, best-effort logging collection nothing else
reads. If `GROQ_API_KEY` is unset, its AI routes degrade gracefully instead of failing outright:
interview and assessment generation fall back to local placeholder questions, resume improvement
returns the original text unchanged, and the remaining resume routes return a clear `503`.
`node-api` never needs to know which case it hit.

## Security

Both services document their own controls in full, but the expectations shared across the stack
are:

- `JWT_SECRET` and `JWT_REFRESH_SECRET` have no defaults — the stack refuses to start without
  them, rather than boot with a guessable value.
- `AI_SERVICE_SHARED_SECRET` must match between `node-api` and `ai-service`; it's the only thing
  standing between an attacker who can reach `ai-service`'s port and a forged internal token.
  Running `ai-service` with `AI_SERVICE_ENV=production` while that secret is still the public
  default from `.env.example` makes it refuse to start.
- `node-api` enforces RBAC and institution-level data scoping on every route, validates every
  write with Joi, whitelists writable fields per entity against mass-assignment, and rate-limits
  both globally and on auth routes specifically.

See [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) for the full audit history and
[`node-api/docs/CREDENTIAL_ROTATION.md`](node-api/docs/CREDENTIAL_ROTATION.md) for the credential
rotation checklist.

## Project history

This repo used to hold a third service, `python-service/` (Python/FastAPI/MongoDB), duplicating
`node-api`'s routes — auth, students, placements — against a separate database. It predated
`node-api`, and once `node-api` reached full functional parity with every route the frontend
actually calls, keeping both running was pure duplicated maintenance with no remaining benefit. It
was removed; its git history is preserved, and the full migration record lives in
`SECURITY_AUDIT.md`.

`ai-service` is not that service coming back. It's a deliberately smaller, newly built replacement
for one narrow slice of what `python-service` used to do — the AI features — built from scratch,
owning none of the old service's business data and never exposed to the frontend directly.

## Repository layout

```
backend/
├── node-api/        Express API — see node-api/README.md
├── ai-service/      FastAPI microservice — see ai-service/README.md
├── deploy/          nginx config, credential rotation notes
├── docker-compose.yml
├── cloudbuild.yaml  Cloud Run deployment
├── SECURITY_AUDIT.md
└── REQUIREMENTS.md
```
