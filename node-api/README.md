# TalentSnaps Node API

Clean-architecture REST backend (Node.js/Express) backed by MongoDB.
Lives in its own folder (`node-api/`) as an independent deployable — see [`REQUIREMENTS.md`](REQUIREMENTS.md)
for prerequisites and [`../README.md`](../README.md) for how this fits alongside the Python service.

## Quick start

```bash
cd node-api
npm install
cp .env.node.example .env.node   # fill in real MONGODB_URI/JWT/Google values
npm run db:test                  # verifies DB connectivity
npm run db:setup-indexes         # creates all collections' indexes (idempotent)
npm run dev                      # http://localhost:5000
```

## Architecture (`src/`)

```
src/
  config/        env.js, database.js (MongoClient), constants.js (roles)
  controllers/    HTTP request/response handlers only — no DB access, no business rules
  services/       business logic; BaseService gives every entity list/get/create/update/remove
  repositories/   the only layer that talks to MongoDB; BaseRepository gives generic CRUD
                  over a collection, with a whitelist of writable fields per entity
  routes/         Express routers — wire authenticate/authorize/validate per endpoint
  middlewares/    authenticate (JWT), authorize (RBAC), scopeInstitution (multi-tenant), validate (Joi), rateLimiter, errorHandler
  models/         collection name + field whitelist per entity (used by repositories, not an ODM)
  utils/          jwt, password hashing, Google OAuth verification, ApiError/ApiResponse, logger
  validations/    Joi schemas per module
```

Request flow: `route → middlewares (auth/RBAC/validation) → controller → service → repository → MongoDB`.

Every document uses an app-generated UUID string as `_id` (not Mongo's default ObjectId) —
that's what lets JWT payloads, Joi `.uuid()` validation, and cross-entity references (e.g.
`student_id` on a placement application) stay simple strings throughout the codebase.

## Data model notes (MongoDB vs. the old Postgres schema)

MongoDB has no foreign keys, CHECK constraints, or native ENUM types, so a few things that used
to be enforced by the database now live in application code instead:
- **Referential integrity** (e.g. a result must reference a real test assignment) is checked in
  the relevant service before writing — see `src/services/result.service.js` for an example.
- **Valid enum values** (roles, statuses, etc.) are enforced by Joi at the API boundary
  (`src/validations/*.js`), not by storage.
- **Uniqueness** (email, institution code, etc.) is enforced by MongoDB unique indexes, created
  via `scripts/setupIndexes.js` (the Mongo equivalent of the old `sql/schema.sql`).
- **Cascading deletes** (e.g. deleting an institution used to cascade to its departments/students)
  are *not* automatically replicated — deleting a parent document currently leaves child documents
  in place. Add explicit cleanup in the relevant service if you need that behavior.

## Notification emails

Three transactional emails go out through Brevo, all through one engine
(`services/emailNotification.service.js`, a BullMQ job, and the `email_notifications` log):

| Event | When | Template env var |
|---|---|---|
| `test_assigned` | A student is assigned an `active` test (or a `draft` test is activated) | `BREVO_TEST_ASSIGNED_TEMPLATE_ID` |
| `drive_assigned` | A placement drive is `open`/`active` and the student is eligible | `BREVO_DRIVE_ASSIGNED_TEMPLATE_ID` |
| `round_shortlisted` | A student is shortlisted for round 2 or later of a drive | `BREVO_ROUND_SHORTLIST_TEMPLATE_ID` |

**Never twice.** `email_notifications` has one row per `(entity_type, entity_id, student_id, event_type,
round_number)` with a unique index (run `npm run db:setup-indexes`). Re-saving, re-assigning, or
un-shortlisting and re-shortlisting never re-sends. A new event type (e.g. a future `not_selected`)
needs only a handler in `services/notificationHandlers/`, a template id in `config/env.js`, and one
`queueRecipients()` call where it happens.

**How it runs.** The request saves its change, records `queued` rows, enqueues a job and returns at
once with `notifying_count`. The worker sends one `messageVersion` per student, `BREVO_BATCH_SIZE` per
call (Brevo's documented limits: 1000 versions / 2000 recipients per request, 99 per version), pausing
`BREVO_MIN_REQUEST_INTERVAL_MS` between calls. Failed calls retry up to `BREVO_MAX_ATTEMPTS` times with
exponential backoff; a 429 waits for `Retry-After`; a 400 is split in half to isolate a bad recipient.
Set `REDIS_URL`. Local dev: `NOTIFICATION_WORKER_MODE=inprocess` (default) runs the worker inside
`npm run dev`. Production: `NOTIFICATION_WORKER_MODE=separate` on the API, and `npm run worker` as its own
service. Without `REDIS_URL` the send runs inside the API process. Students with a missing/invalid email or
an inactive account are recorded as `failed` with the reason and logged.

### Set up the Brevo templates

1. In Brevo verify the sender (`BREVO_SENDER_EMAIL`) and create an API key (`BREVO_API_KEY`).
2. Create three transactional templates (New Template Language), pasting the HTML from
   [`docs/email-templates/`](docs/email-templates/): `test-assigned.html`, `drive-assigned.html`,
   `round-shortlisted.html`. Set each subject as written in the comment at the top of the file, and put the
   three template ids in the env vars above.
3. Params. Dates are IST. Missing optional values are sent as `""`.
   - Test: `studentName, assessmentTitle, departmentName, batchName, startDateTime, endDateTime, durationMinutes, testLink`
   - Drive: `studentName, companyName, companyLogoUrl, jobRole, packageCtc, location, driveDate, lastDateToApply, eligibilitySummary, driveLink`
   - Round: `studentName, companyName, companyLogoUrl, jobRole, roundNumber, roundName, roundDateTime, venueOrLink, instructions, driveLink`
4. **Logo fallback.** The drive templates use Brevo conditionals so a drive with no logo shows the company
   name as text, never a broken image:

   ```
   {% if params.companyLogoUrl %}
     <img src="{{ params.companyLogoUrl }}" alt="{{ params.companyName }}" width="200" style="display:block;width:200px;max-width:100%;height:auto;">
   {% else %}
     <div>{{ params.companyName }}</div>
   {% endif %}
   ```

   The same `{% if %}` hides the location, drive date, apply-by date, round time, venue/link and instructions
   when they're empty.

### Company logos

`POST /placements/logo` (or `/jobs/logo`) accepts JPEG/PNG/GIF/WebP up to **2 MB**, scales it to fit
**400×160** (aspect ratio kept, never enlarged) and re-encodes it as **PNG** — the format every email client
shows. Upload ~400×160 px for sharp rendering; the email displays it at 200 px wide. With
`GCS_PUBLIC_LOGO_BUCKET` set, the processed PNG goes to that public-read bucket and the response's
`logo_ref` is its permanent public URL, which is what you send back as `company_logo_url` and what the email
uses. The main bucket stays private. Drives whose logo is still a private reference (uploaded before the
public bucket existed) email with the company name as text until their logo is re-uploaded.

Bucket setup: create a separate bucket, grant `allUsers` the *Storage Object Viewer* role (uniform
bucket-level access), and give the API's service account *Storage Object Admin* on it.

### Drives: rounds and API

- Round **numbers** are the integer `round` (1–20) on a shortlist (`POST /placement-applications` and
  `/placement-applications/bulk-shortlist`). Round 1 and shortlists without a round never email.
- Define what a round is: `PUT /drives/:id/rounds/:roundNumber` with any of `name, scheduled_at,
  venue_or_link, instructions` (`GET /drives/:id/rounds` lists them). The round email reads these when it
  is sent; a round with no details sends with those blocks hidden.
- Eligibility for the drive email: `eligible_departments` (name or code), `eligible_years` (batch years) and
  `min_cgpa`; an empty rule means no restriction, and a student with no CGPA is not eligible for a drive with
  a minimum. The free-form `eligibility_criteria` is not applied. Editing these on a live drive emails only
  the newly eligible students.
- `POST /placements`, `PUT /placements/:id`, the shortlist endpoints and `POST /test-assignments` all return
  `notifying_count`.
- `GET /drives/:id/notifications?event_type=&round_number=` returns `{ sent, failed, pending, total,
  failed_recipients }`; `POST /drives/:id/notifications/resend-failed` (body `{ event_type?, round_number? }`)
  re-queues failed rows only. Tests have the same pair at `/tests/:id/notifications` and
  `/tests/:id/notifications/resend-failed`.

### Try it with a sample drive

1. Put 2–3 students (your own addresses) in one department with `batch_year` 2027 and a CGPA.
2. As an institution admin: `POST /placements` with `{ "title": "SDE", "company_name": "Acme", "status": "open",
   "eligible_years": [2027], "min_cgpa": 7, "company_logo_url": "<logo_ref from /placements/logo>" }`.
   The response has `notifying_count`; check the inbox.
3. `PUT /drives/:id/rounds/2` with a name, time, link and instructions, then
   `POST /placement-applications/bulk-shortlist` with `{ "placement_id", "round": 2, "student_ids": [...] }`.
4. `GET /drives/:id/notifications?round_number=2` to see the summary; fix any failure and resend.

`npm test -- testAssignedEmail placementDriveEmail placementLogoPublic` covers all of this with Brevo and GCS mocked.


## Security

Helmet, strict CORS allowlist, global + auth-specific rate limiting, Joi input validation on every
write endpoint, a fixed field whitelist per entity (no mass-assignment), bcrypt password hashing,
JWT access + refresh tokens, Google ID token verification, and RBAC enforced per-route plus
institution-level row scoping in the service layer.

## Roles

`super_admin` → `institution_admin` → `hr` / `faculty` → `student`. See `docs/API.md` for the
full per-endpoint role matrix.

## Docs

- [`docs/API.md`](docs/API.md) — endpoint reference
- [`docs/FRONTEND_INTEGRATION.md`](docs/FRONTEND_INTEGRATION.md) — Axios client + CORS setup for the frontend
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Cloud Run + MongoDB Atlas deployment, scaling, Redis setup
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — WebSocket auth migration, rate-limiting architecture, monitoring, troubleshooting, rollback
- [`docs/CREDENTIAL_ROTATION.md`](docs/CREDENTIAL_ROTATION.md) — credential rotation checklist
- [`scripts/setupIndexes.js`](scripts/setupIndexes.js) — full index plan (16 collections, uniqueness + query indexes)
