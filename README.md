# UpScaler-AI Backend

[![CI](https://github.com/KIVOX-dev/backend/actions/workflows/ci.yml/badge.svg)](https://github.com/KIVOX-dev/backend/actions/workflows/ci.yml)

UpScaler-AI is a placement and career-readiness platform. Students take tests and mock
interviews, build resumes, and track placement applications. Faculty, HR, and institution admins
manage the pipeline behind them. This repository holds the two backend services that run it.

| Service | Stack | Role |
|---|---|---|
| [`node-api/`](node-api/README.md) | Node.js 24, Express 5, MongoDB | The public API. Every route the frontend calls lives here, and it owns all business data. |
| [`ai-service/`](ai-service/README.md) | Python 3.12, FastAPI | An internal microservice for Groq-backed AI features. Only `node-api` calls it; the frontend never does. |

## Features

- **Institutions and people**: super admins, institution admins, college admins, HR, faculty, and
  students. Each role sees only its own institution's data.
- **Authentication**: email/password with JWT access and refresh tokens, plus Google, GitHub,
  LinkedIn, and Stack Exchange sign-in.
- **Tests and assessments**: test creation, assignment, question banks, AI-generated questions,
  and results.
- **Mock interviews**: AI-generated interview questions by role and topic, across multiple rounds.
- **Resume builder**: ATS analysis, job-description matching, AI suggestions, parsing, and
  AI-assisted rewrites.
- **Placements**: companies, job listings, applications, placement records, and proof uploads.
- **Student growth**: profiles, roadmaps, courses, leaderboards, and certificate verification.
- **Notifications and chat**: in-app notifications and real-time WebSocket chat, kept in sync
  across API replicas through Redis.
- **Activity logs**: an audit trail of who did what.

The full endpoint reference and per-route role matrix are in
[`node-api/docs/API.md`](node-api/docs/API.md).

## Getting started

### Full stack with Docker Compose

This starts the frontend, two `node-api` replicas behind nginx, `ai-service`, and Redis.

Before you start:

- Clone the frontend next to this repo as `../Upscaler-Frontend`. Compose builds it from there.
- Have a MongoDB connection string ready (for example, MongoDB Atlas). Compose does not run a
  local MongoDB container.

```bash
cp .env.compose.example .env
# Edit .env:
#   JWT_SECRET, JWT_REFRESH_SECRET   required; generate each with: openssl rand -base64 48
#   MONGODB_URI                      required; add this line, it is not in the example file
#   GROQ_API_KEY                     optional; AI features fall back gracefully without it
docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| API (nginx, load-balanced across replicas) | http://localhost:5000 |

### A single service, without Docker

For hot reload while working on one service, follow that service's README:

- [`node-api/README.md`](node-api/README.md): quick start, architecture, data model notes
- [`ai-service/README.md`](ai-service/README.md): quick start, testing, dependency locking

Prerequisites are listed in [`REQUIREMENTS.md`](REQUIREMENTS.md).

## Architecture

```
Browser
  │
  ▼
Frontend (Next.js, :3000)
  │  NEXT_PUBLIC_API_URL
  ▼
nginx (:5000)
  │  round-robin
  ▼
node-api × 2  ──┬──▶  MongoDB   users, students, tests, placements, chat
  │             ├──▶  Redis     shared rate limits, chat pub/sub between replicas
  │ internal JWT
  ▼
ai-service (:8001)  ──▶  Groq API   question generation, resume analysis
```

- `node-api` is the only entry point for the frontend and the source of truth for business data.
- `ai-service` holds no business data. Its only storage is an optional log collection that
  nothing else reads. `node-api` signs a short-lived JWT for every call it makes to it.
- Compose runs two `node-api` replicas on purpose. Without `REDIS_URL`, chat messages stop crossing
  replicas and rate limits become per-instance. Running two locally makes that kind of bug show
  up before production does.
- If `GROQ_API_KEY` is unset, `ai-service` degrades instead of failing. Interview and assessment
  generation return local placeholder questions, resume improvement returns the original text,
  and the other resume routes return `503`. `node-api` translates each of these into the error
  format the frontend already expects.

## Security

Each service documents its own controls. These rules apply across the stack:

- `JWT_SECRET` and `JWT_REFRESH_SECRET` have no defaults. The stack will not start without them.
- `AI_SERVICE_SHARED_SECRET` must be identical in `node-api` and `ai-service`. It is the only
  thing that stops anyone who can reach `ai-service`'s port from forging an internal token. With
  `AI_SERVICE_ENV=production`, `ai-service` refuses to start while this is still the public
  default.
- `node-api` enforces RBAC and institution scoping on every route, validates every write with
  Joi, whitelists writable fields per entity, and rate-limits globally and on auth routes.

See [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) for the audit history and
[`node-api/docs/CREDENTIAL_ROTATION.md`](node-api/docs/CREDENTIAL_ROTATION.md) for the rotation
checklist.

## Testing and CI

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on pushes and pull
requests to `main`:

- `node-api`: `npm run lint`, `npm test` (Jest), and `npm audit --audit-level=high`
- `ai-service`: `ruff check .` and `pytest` (Groq calls are mocked)

## Deployment

[`cloudbuild.yaml`](cloudbuild.yaml) builds both services' images and deploys them to Google
Cloud Run, reading secrets from Secret Manager. The file header lists the required IAM roles and
secrets. See [`node-api/docs/DEPLOYMENT.md`](node-api/docs/DEPLOYMENT.md) and
[`node-api/docs/OPERATIONS.md`](node-api/docs/OPERATIONS.md) for the full process.

## Repository layout

```
backend/
├── node-api/              Express API (see node-api/README.md)
├── ai-service/            FastAPI AI microservice (see ai-service/README.md)
├── deploy/                nginx config, credential rotation notes
├── .github/workflows/     CI
├── docker-compose.yml     full local stack
├── .env.compose.example   template for the compose .env
├── cloudbuild.yaml        Cloud Run deployment
├── SECURITY_AUDIT.md
└── REQUIREMENTS.md
```

## History

This repo once held a third service, `python-service/`, which duplicated `node-api`'s routes
against a separate database. It was removed once `node-api` covered every route the frontend
uses. Its git history is preserved, and `SECURITY_AUDIT.md` records the migration.

`ai-service` is not that service coming back. It is a new, much smaller service built only for
the AI features. It owns no business data, and the frontend never calls it.
