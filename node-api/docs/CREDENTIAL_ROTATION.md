# Credential Rotation Runbook

## Why this exists

A MongoDB Atlas password previously lived in plaintext in `python-service/seed_mongo.py`.
`python-service/` has since been deleted (see `SECURITY_AUDIT.md` §13), but deleting the file does
**not** rotate the credential — it is still recoverable from git history by anyone with read access
to this repository. It must be treated as compromised and rotated, independent of the file's removal.

This document is the general-purpose process for rotating any credential this service depends on
(`MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `GOOGLE_CLIENT_SECRET`, `BREVO_API_KEY`,
`GROQ_API_KEY`, `REDIS_URL`), not just the one that's already known-compromised.

## What actually has to happen, and who does it

Rotating the Atlas password requires access to the MongoDB Atlas console/API for this project —
**this step cannot be performed by an automated coding assistant**; it has to be done by whoever
holds Atlas access for this org. Everything else on this checklist (updating secrets stores,
verifying the app reconnects, confirming the old credential is dead) can be done once the new
password exists.

## Checklist

### 1. Generate the new credential

- [ ] Atlas → Database Access → the affected database user → Edit → Generate a new, strong
      auto-generated password (don't hand-type one — Atlas's generator avoids characters that need
      extra URL-encoding in a `mongodb+srv://` connection string).
- [ ] Copy the new full connection string immediately — Atlas will not show the password again.
- [ ] Record the rotation date and who performed it (bottom of this file, or your team's incident log).

### 2. Update every environment that holds the old credential

Check off only after confirming the *new* value is actually live in that environment — updating a
secret store without redeploying/restarting the consumer leaves it running on the old value.

- [ ] **Local development** (`node-api/.env.node`) — update `MONGODB_URI`, confirm
      `npm run dev` connects (watch for `"Connected to MongoDB"` in the startup log).
- [ ] **CI** (GitHub Actions secrets, if any workflow uses a real `MONGODB_URI` rather than the
      ephemeral `mongo:7` service container `node-test`/`docker-build` already use) — update the
      repo/org secret.
- [ ] **Staging** — update the secret store (GCP Secret Manager / equivalent), redeploy or restart
      the service so it picks up the new value, confirm `/health/ready` reports `mongo.status: ok`.
- [ ] **Production** — same as staging. Deploy the new secret *before* invalidating the old
      credential (next step) so there's no window where neither works.
- [ ] **Docker/local containers** — any `docker run`/`docker-compose` invocation that passes
      `MONGODB_URI` via `-e` or an env file.
- [ ] Any other service/script that reads this credential directly (seed scripts, one-off admin
      tooling) — grep for `MONGODB_URI` outside of `node-api/` to be sure nothing was missed.

### 3. Invalidate the old credential

Only after every environment above is confirmed running on the new value:

- [ ] Atlas → Database Access → delete the old database user (or, if it's the same user with a
      rotated password, this step is already done by step 1 — Atlas doesn't keep the old password
      valid after a reset). Confirm: attempting to connect with the old connection string now fails.

### 4. Verify

- [ ] Application starts cleanly in every updated environment (`"Connected to MongoDB"` log line,
      no startup crash).
- [ ] `GET /health/ready` returns `{"status":"ready", "checks":{"mongo":{"status":"ok",...}}}` in
      each environment.
- [ ] `npm run db:setup-indexes` (or equivalent) still runs against the new connection string if
      you need to re-verify indexes exist.
- [ ] A real login (`POST /auth/login`) succeeds end-to-end — proves the app can both read (find
      user) and write (update `last_login_at`) with the new credential, not just connect.
- [ ] No service anywhere is still configured with the old connection string (search every
      environment's secret store / env file for the old value, not just the ones you remember
      updating).

### 5. Record the rotation

| Field | Value |
|---|---|
| Credential rotated | `MONGODB_URI` (Atlas database user password) |
| Rotation date | _fill in when performed_ |
| Performed by | _fill in_ |
| Old credential invalidated | _yes/no + date_ |
| Environments updated | local / CI / staging / production / other: _____ |
| Verification method | `/health/ready` + real login, per §4 above |

## Rollback

If the new credential turns out to be wrong (typo, wrong user, insufficient permissions) and the
old one hasn't been invalidated yet: just revert the secret store / env value back to the old
connection string and redeploy — the old credential is still valid until step 3 is done, which is
exactly why step 3 is ordered *after* step 2's verification, not before it.

If the old credential was already invalidated and the new one is broken: generate another new
password (back to step 1) — Atlas doesn't restore a deleted/rotated-away credential.

## Applying this same process to other credentials

The same five-step shape (generate → update every environment → invalidate old → verify → record)
applies to:

- **`JWT_SECRET` / `JWT_REFRESH_SECRET`** — rotating these invalidates *every* currently-issued
  access and refresh token instantly (unlike a per-user `token_version` bump — see
  `auth.service.js` — this is global). Every logged-in user gets signed out. Plan this as a
  maintenance-window action, not a silent rotation.
- **`GOOGLE_CLIENT_SECRET`** — rotate in Google Cloud Console → APIs & Services → Credentials;
  "Continue with Google" stops working for any environment still on the old secret until updated.
- **`REDIS_URL`** (if using an authenticated Redis) — rate limiting and chat broadcasting both
  degrade to their single-instance fallback automatically if Redis becomes unreachable mid-rotation
  (see `config/redis.js`), so this one is lower-risk to rotate than the others — nothing goes down,
  it just temporarily loses cross-instance coordination.
- **`BREVO_API_KEY` / `GROQ_API_KEY`** — lowest risk: `email.service.js`/`groqClient.js` both
  already check `isEmailConfigured()`/`isGroqConfigured()` and degrade gracefully rather than crash
  if these are absent or invalid — email sending / AI features pause, nothing else breaks.
