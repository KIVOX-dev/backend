# UpScaler-AI Node API — Reference

Base URL (dev): `http://localhost:5000/api/v1`

All request/response bodies are JSON. All non-auth endpoints require:

```
Authorization: Bearer <accessToken>
```

Every response follows the shape:

```json
{ "success": true, "message": "...", "data": { }, "timestamp": "2026-08-01T...", "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3, "hasNext": true, "hasPrevious": false } }
```

Errors:

```json
{ "success": false, "message": "...", "detail": "...", "code": "VALIDATION_ERROR", "timestamp": "2026-08-01T...", "details": ["optional per-field validation messages"] }
```

`code` is a stable, machine-readable identifier (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`VALIDATION_ERROR`, `CONFLICT`, `TOO_MANY_REQUESTS`, `FILE_TOO_LARGE`, `SERVICE_UNAVAILABLE`,
`INTERNAL_ERROR`, ...) meant for client-side branching logic — `message`/`detail` are for display
only and may reword over time. `detail` duplicates `message` for legacy clients that read
FastAPI's `HTTPException` shape; new code should read `message` or `code`.

## Roles

`super_admin` · `institution_admin` · `hr` · `faculty` · `student`

Row-level scoping: everyone except `super_admin` is confined to their own `institution_id`
(enforced server-side, not client-supplied) via the `scopeInstitution` middleware or explicit
service-layer checks. Students only ever see/act on their own student/application/result rows.

## Auth — `/auth`

| Method | Path              | Auth | Body                                             | Notes                                |
|--------|-------------------|------|--------------------------------------------------|---------------------------------------|
| POST   | `/auth/register`  | none | `email, password, fullName, phone?, institutionId?` | Always creates a `student` account |
| POST   | `/auth/login`     | none | `email, password`                                | Returns `{ user, accessToken, refreshToken }` |
| POST   | `/auth/google`    | none | `idToken`                                        | Verifies Google ID token server-side  |
| POST   | `/auth/refresh`   | none | `refreshToken`                                   | Returns new `{ accessToken, refreshToken }` |
| GET    | `/auth/me`        | any  | —                                                 | Current user profile                  |
| PUT    | `/auth/change-password` | any | `currentPassword`/`current_password`, `newPassword`/`new_password` | Bumps `token_version` (invalidates other sessions' refresh tokens), returns a fresh token pair for the caller's own session |

`POST /auth/refresh` accepts the token as either `refreshToken` or `refresh_token` in the body, and
its response includes the new tokens both nested under `data` (standard envelope) *and* flattened
at the top level (`access_token`/`refresh_token`) — a compatibility shim for a bare-axios frontend
call site that skips the usual envelope-unwrap interceptor. New clients can use either shape.

Non-student accounts (institution_admin, hr, faculty) are provisioned by `super_admin` /
`institution_admin` through `POST /users`, not through public registration.

## Users — `/users`

CRUD for the central `users` table. `super_admin`, `institution_admin` only.
Institution admins may only create/manage `hr`, `faculty`, `student` roles inside their own
institution; role/institution fields are stripped from their update payloads server-side.

`GET /`, `GET /:id`, `POST /`, `PUT /:id` (super_admin + institution_admin), `DELETE /:id` (super_admin only)

## Institutions — `/institutions`

Lookup entity. Read: `super_admin`, `institution_admin`. Write: `super_admin` only.

## Departments — `/departments`

Institution-scoped. Read: any authenticated role (own institution). Write: `super_admin`, `institution_admin`.

## College Admins — `/college-admins`

Links a `user` to an `institution` as an admin. Full CRUD: `super_admin` only. Read: `super_admin`, `institution_admin`.

## Companies — `/companies`

Global lookup entity (not institution-scoped). Read: any role. Write: `super_admin` only.

## HR — `/hr`

Links a `user` to a `company`. Read: `super_admin`, `institution_admin`, `hr`. Write: `super_admin` only.

## Faculty — `/faculty`

Institution-scoped. Read: any role (own institution). Write: `super_admin`, `institution_admin`.

## Students — `/students`

Institution-scoped. Read: any role (own institution). Write (create/update): `super_admin`,
`institution_admin`, `faculty`. Delete: `super_admin`, `institution_admin`.

## Placements — `/placements`

Placement drives posted by a company at an institution.

| Method | Path | Roles | Notes |
|--------|------|-------|-------|
| GET | `/` , `/:id` | any | browse open drives |
| POST | `/` | super_admin, institution_admin, hr | `created_by` forced to caller; institution_admin's `institution_id` forced to their own |
| PUT | `/:id` | super_admin, institution_admin, hr | |
| DELETE | `/:id` | super_admin, institution_admin | |

Also mounted at `/jobs` — same router, same controller/service, identical behavior under both
prefixes (including `/jobs/me`, `/jobs/drives`, `/jobs/applications/me`). Exists for a frontend
module that still calls the pre-migration `/jobs` path name.

## Placement Applications — `/placement-applications`

| Method | Path | Roles | Notes |
|--------|------|-------|-------|
| GET | `/`, `/:id` | any | students only ever see their own applications |
| POST | `/` | student | `student_id` derived from the caller, never from the body |
| PATCH | `/:id/status` | student (withdraw only, own row), hr/institution_admin/faculty/super_admin (any status) | |

## Tests — `/tests`

Institution-scoped assessments. Read: any role (own institution). Write: `super_admin`,
`institution_admin`, `faculty` (`created_by`/`institution_id` forced server-side).

## Test Assignments — `/test-assignments`

Assigns a test to a student. Read: any role (students see only their own). Write:
`super_admin`, `institution_admin`, `faculty` (`assigned_by` forced to caller).

## Results — `/results`

Recorded against a `test_assignment_id`; `student_id`/`test_id` are derived from that
assignment (never client-supplied), and the assignment is auto-marked `completed`.
Read: any role (students see only their own). Write: `super_admin`, `institution_admin`, `faculty`.

## Notifications — `/notifications`

Personal inbox — `GET /` always returns only the caller's own notifications, for every role.

| Method | Path | Roles |
|--------|------|-------|
| GET | `/` | any (self only) |
| PATCH | `/:id/read` | any (must own the notification) |
| POST | `/` | super_admin, institution_admin, faculty, hr — sends to a target `user_id` |

## Resume Builder — `/resume-builder`

| Method | Path | Roles |
|--------|------|-------|
| GET / PUT | `/me` | student — own resume only |
| GET | `/`, `/:id` | super_admin, institution_admin, faculty, hr — read-only |

## Activity Logs — `/activity-logs`

Read-only audit trail. `super_admin` only. Entries are written internally
(`src/utils/recordActivity.js`), never through a public write endpoint.

## Pagination

All list endpoints accept `?page=1&limit=20` (limit capped at 100) and `?sortBy=<field>&sortOrder=asc|desc`
(`sortBy` is whitelisted against that entity's real columns server-side — an unrecognized field is
a silent no-op, not a 400). Responses include `meta.total`/`meta.page`/`meta.limit`/`meta.totalPages`/
`meta.hasNext`/`meta.hasPrevious`.

A few endpoints intentionally return everything unpaginated rather than truncating silently —
`GET /departments` (a college realistically has dozens, not thousands, and every consumer wants
the full list for a dropdown) being the clearest example. Where an endpoint returns more than
`limit` rows without real pagination (e.g. `GET /jobs/me`, capped at 1000), the true total is
still exposed via an `X-Total-Count` response header even though the body stays a plain array.

## Health, readiness, and metrics — `/health`

Unauthenticated, and — unlike every endpoint above — not subject to rate limiting (see
`docs/OPERATIONS.md`'s "Rate limiting architecture" for why).

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health`, `/health/live` | Liveness — process is alive, no downstream checks |
| GET | `/health/ready` | Readiness — real Mongo ping (required), Redis ping if configured (informational only) |
| GET | `/health/metrics` | Plain JSON: uptime, memory, local WebSocket connection count, Redis state |
