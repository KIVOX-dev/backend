# MongoDB → Firestore (MongoDB compatibility) migration tooling

Standalone CLI tooling. **Not imported by, or reachable from, `src/`** — running
anything in this directory has zero effect on the running application.
Nothing here changes `MONGODB_URI`, writes to the existing MongoDB, or
redeploys anything.

## Safety guarantees baked into this tool

- `lib/sourceDb.js` exposes only `connect / listCollectionNames /
  countDocuments / findBatch` — there is no `insert`/`update`/`delete`/`drop`
  method anywhere in this tool's source-side code path.
- The target connection (`lib/targetDb.js`) only ever touches Firestore, via
  the OIDC connection string in `FIRESTORE_MONGODB_URI` — never hardcoded,
  never logged (`lib/redact.js` scrubs every log line).
- Every write is an upsert keyed on the document's existing `_id` — re-running
  `migrate.js` is always safe and never creates duplicates.
- Progress is checkpointed per collection (`.checkpoints/`, gitignored) so an
  interrupted run resumes instead of restarting.

## Setup

```bash
cd node-api
cp migration/.env.migration.example .env.migration
# edit .env.migration: paste the Firestore OIDC connection string Google generated
gcloud auth application-default login   # or confirm the Cloud Run service account has Firestore access
```

## Running the migration (Phases 2–4)

```bash
npm run migrate:run
```

Copies every collection found on the source MongoDB (discovered dynamically,
not hardcoded) into the Firestore target, batching + retrying + checkpointing
as it goes. Prints a per-collection table and writes a JSON report to
`migration/reports/migrate-<timestamp>.json`. If any collection's final count
doesn't match, or any document failed permanently, the run exits non-zero and
prints **"MISMATCH DETECTED — DO NOT PROCEED TO PRODUCTION CUTOVER"**. Just
re-run `npm run migrate:run` to retry — it resumes from checkpoints and only
re-touches what didn't finish.

## Verifying the data (Phase 5)

```bash
npm run migrate:verify
```

Independently re-reads **every document from both databases** (not just
counts) and compares a canonical SHA-256 checksum per document — catching a
dropped field or changed value even if counts happen to match. Produces:

```
COLLECTION | MONGODB COUNT | FIRESTORE COUNT | MATCH | DIFFERENCES
```

and a JSON report under `migration/reports/`. The migration is not considered
done until this reports `SUCCESS` for every collection.

## Recreating indexes on the target (Phase 7)

```bash
npm run migrate:setup-indexes
```

Firestore does **not** automatically carry over MongoDB indexes — this
explicitly recreates every index from `../scripts/setupIndexes.js`'s plan
(mirrored in `lib/indexPlan.js` — see the comment there about a known drift:
the live MongoDB's `interview_responses` index doesn't yet match current code,
this tool builds from current code's intent). Reports which indexes were
created vs. failed. Per the current Firestore-with-MongoDB-compatibility
docs, every index type this app uses (unique, sparse, compound, single-field)
is supported, so no failures are expected — but this tool checks rather than
assumes it, per the migration plan's Phase 7 requirement.

## Application compatibility testing (Phase 6) — without touching production

Production's `MONGODB_URI` (Cloud Run secret `node-api-mongodb-uri`) is never
touched by any of this. To point a **local** run of the app at Firestore for
testing, without changing any source code:

```bash
# From node-api/, with .env.node already set up as usual:
cp .env.node .env.node.firestore-test
# Edit .env.node.firestore-test: replace MONGODB_URI with your
# FIRESTORE_MONGODB_URI value (same one used for migration).

npx dotenv-cli -e .env.node.firestore-test -- node src/server.js
```

This works with **zero code changes** because `dotenv-cli` sets
`process.env` before Node even loads `src/config/env.js`, and `dotenv`'s own
`.config()` call (which loads `.env.node`) never overrides a variable that's
already set — so `MONGODB_URI` ends up pointing at Firestore for this run
only, in this terminal only. (`dotenv-cli` isn't installed yet — add it with
`npm install --save-dev dotenv-cli`, or use `env-cmd` / your shell's own
`export MONGODB_URI=... ` for the same effect.)

Test every route category the migration plan calls out (auth, students,
tests, placements, dashboards, admin/institution CRUD, search/sort/pagination,
aggregations, resume builder) against this instance and record anything that
behaves differently. **Do not silently patch application logic to work around
a difference** — report it back first, per Phase 6 of the migration plan.

## Rollback (Phase 8)

There is nothing to roll back on the MongoDB side — it was never modified,
deleted, or disconnected at any point in this process. "Rollback" here only
ever means: **the production Cloud Run service keeps using its existing
`node-api-mongodb-uri` secret**, which remains true unless a human explicitly
changes the `--set-secrets` mapping in `cloudbuild.yaml` and redeploys. If a
future cutover ever needs to be reversed, it is exactly that redeploy, run in
reverse, pointing `MONGODB_URI` back at the original secret — no data
migration undo is required since MongoDB was never touched.

## What this tool deliberately does NOT do

- Does not change `src/config/env.js`, `src/config/database.js`, or any
  application source.
- Does not modify `cloudbuild.yaml` or any Cloud Run deploy configuration.
- Does not delete, drop, or write to any collection in the source MongoDB.
- Does not run automatically — every step above is a manually-invoked
  `npm run migrate:*` command.
