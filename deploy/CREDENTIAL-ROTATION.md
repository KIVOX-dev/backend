# Credential rotation runbook

Nothing here can be automated from this repo — every step needs console access
to a third-party service. Ordered by urgency.

---

## 1. `KAVI123` on `cluster0.wdl8tpt.mongodb.net` — **EXPOSED, revoke now**

**Status: publicly readable on GitHub right now.**

A plaintext Atlas password for this user was committed in
`python-service/seed_mongo.py`. The file was later deleted, but deletion does
not remove it from history — it remains in commits `0274160` and `1f68007`,
both reachable from `origin/main` and three other branches on
`github.com/KIVOX-dev/backend`, which is a **public** repository.

Assume this credential is compromised. Anyone who has cloned or scraped the
repo has it.

1. **Atlas → Database Access → delete the `KAVI123` user.** Delete, don't
   rotate — if nothing still uses it (nothing in this working tree references
   it), removal is cleaner than a new password.
2. **Atlas → check that cluster's activity/access logs** for connections you
   don't recognise, and review its collections for unexpected writes or drops.
3. Only after (1): decide whether to purge history. Rewriting with
   `git filter-repo` and force-pushing invalidates every existing clone and
   open PR, and does **not** un-leak anything already scraped — which is why
   revoking comes first and rewriting is optional cleanup, not the fix.

> If that cluster is already decommissioned, confirm it in Atlas rather than
> assuming — a forgotten free-tier cluster left running with a leaked password
> is exactly the case worth checking.

---

## 2. `globaleducationgv_db_user` on `cluster0.o90ixew.mongodb.net` — rotate

**Status: never committed.** I scanned every commit in the repository; neither
this cluster's hostname nor the Brevo key below appears in any of them. Its
only exposure is `node-api/.env.node` on local machines, which is gitignored.

This is hygiene, not an incident — but it has been flagged across several
review rounds and is the live production credential.

1. Atlas → Database Access → edit the user → **Edit Password** → autogenerate.
2. Update `MONGODB_URI` in `node-api/.env.node` locally.
3. Update it in whatever runs production (Cloud Run: put it in Secret Manager
   and reference it with `--set-secrets`, rather than `--set-env-vars`, so the
   value never appears in a revision's plaintext config).
4. Restart node-api and confirm `GET /health/ready` reports `mongo: ok`.

---

## 3. Brevo API key — rotate

**Status: never committed** (verified by the same full-history scan). Present
in `node-api/.env.node` only.

1. Brevo → SMTP & API → API Keys → delete the existing key, create a new one.
2. Update `BREVO_API_KEY` in `.env.node` and in production secrets.
3. Confirm: registering a user should log a sent verification email rather
   than `Email not sent — Brevo is not configured`.

---

## 4. Google OAuth client secret — rotate if it was ever shared

`GOOGLE_CLIENT_SECRET` lives in `.env.node`. Not committed. Rotate through
Google Cloud Console → APIs & Services → Credentials if it has ever been
pasted into a chat, ticket, or shared document.

---

## 5. Application secrets you control — regenerate at will

These are values *you choose*, not third-party credentials, so they can be
rotated with no external console:

| Variable | Where | Effect of rotating |
|---|---|---|
| `JWT_SECRET` | node-api | **Logs every user out immediately.** Every access token becomes invalid. |
| `JWT_REFRESH_SECRET` | node-api | Invalidates all refresh tokens; users must log in again. |
| `AI_SERVICE_SHARED_SECRET` | node-api **and** ai-service | Must change in **both at once** — a mismatch makes every AI request 401 until they agree. |

Generate each with `openssl rand -base64 48`.

Rotate the two JWT secrets during a low-traffic window, since the entire user
base is signed out the moment they change. `AI_SERVICE_SHARED_SECRET` has no
user-visible effect if both services are updated together — with
`docker-compose.yml` both read the same variable, so they cannot drift.

---

## Verifying nothing new has leaked

The full-history scan used to produce the statuses above:

```bash
# Replace the pattern with the hostname / key prefix you want to check.
for c in $(git rev-list --all); do
  git grep -q "PATTERN" "$c" -- 2>/dev/null && echo "FOUND in $c"
done
```

Do **not** pipe that `git grep` into `head` — the pipeline's exit status
becomes `head`'s, which is always 0, and every commit reports as a match. That
false positive is what initially made the current cluster look compromised
when it was not.

Longer term, a `gitleaks` or `trufflehog` job in CI catches this at push time
rather than during a review months later.
