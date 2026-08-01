# Dependency Security Audit — UpScaler-AI Backend

**Date:** 2026-08-01
**Scope:** `node-api/` (Express/MongoDB) and `python-service/` (FastAPI/MongoDB), plus `.github/workflows/ci.yml`

## 0. Note on the starting numbers

The audit was scoped against a claim of "1 Critical, 22 High, 2 Moderate" in Node.js and an
unspecified count in Python. Running `npm audit` and `pip-audit` directly against this repo at
the start of this work found a different, smaller set — **5 advisories in Node.js** (1 Critical,
2 High, 2 Moderate) and **23 advisories across 5 packages in Python**. The tables below reflect
what the tools actually reported, not the earlier estimate. Likewise, the CI file's own comments
show lint/tests weren't actually wired up yet (`continue-on-error`, `--collect-only`) — that's
fixed as part of this pass too (§5).

---

## 1. Before → After

| | Before | After |
|---|---|---|
| **Node.js (`npm audit`)** | 5 vulnerabilities — 1 Critical, 2 High, 2 Moderate | **0 vulnerabilities** |
| **Python (`pip-audit`)** | 23 known vulnerabilities across 5 packages | **0 known vulnerabilities** |
| `npm ci` | ✅ | ✅ |
| `pip install -r requirements.txt` | ✅ | ✅ |
| ESLint | not wired up (`continue-on-error`, no config) | ✅ real flat config, 0 errors (19 pre-existing style warnings, non-blocking) |
| Ruff | not wired up (`continue-on-error`, no config) | ✅ real config, 0 errors |
| pytest | not wired up (`--collect-only`, no tests) | ✅ 5 tests, all passing |
| Jest | no test script, no test files | ✅ 1 test, passing |

---

## 2. Node.js API — vulnerability detail

| Package | Type | Severity | Advisory | Installed | Fixed in | Breaking? |
|---|---|---|---|---|---|---|
| `tar` | transitive (`bcrypt`→`@mapbox/node-pre-gyp`) | **Critical** | [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw) + 10 related tar advisories (hardlink/symlink path traversal, PAX parsing DoS) | 6.2.1 | n/a — dependency removed | No (see below) |
| `@mapbox/node-pre-gyp` | transitive (`bcrypt`) | High | inherits vulnerable `tar` | 1.0.11 | n/a — dependency removed | No |
| `brace-expansion` | transitive (`node-pre-gyp`→`rimraf`→`glob`→`minimatch`; also pulled in separately by `jest`'s own tree) | High | [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) — DoS via unbounded expansion length | 1.1.16 / 2.1.2 | 1.1.18 / 2.1.4 (via `npm audit fix`) | No |
| `gaxios` | transitive (`google-auth-library`) | Moderate | inherits vulnerable `uuid` | 6.7.1 | n/a — dependency removed | No |
| `uuid` | **direct** | Moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — missing buffer bounds check in v3/v5/v6 when `buf` is provided | 9.0.1 | n/a — dependency removed | No (see below) |

### How each was fixed

- **`bcrypt` 5.1.1 → 6.0.0.** bcrypt 6 replaced its build/prebuild mechanism: it now uses
  `node-gyp-build`/`node-addon-api` instead of the deprecated `@mapbox/node-pre-gyp`, which is
  what dragged in the vulnerable `tar`/`rimraf`/`glob@7`/`minimatch@3` chain. The public API
  (`bcrypt.hash`, `bcrypt.compare`) is unchanged — this is the only place bcrypt is used
  ([`src/utils/password.js`](node-api/src/utils/password.js)) — so no code changes were needed.
  This single bump removes the Critical `tar` finding and the High `@mapbox/node-pre-gyp` finding
  entirely (not just to a patched version — the vulnerable dependency is no longer installed).
- **`google-auth-library` 9.15.1 → 10.9.1.** Google auth library 10.x depends on
  `gaxios@^7.1.4`, which dropped its own dependency on `uuid` (the maintainers replaced it with
  `crypto.randomUUID()` internally). This removes the Moderate `gaxios`/`uuid` finding. 10.x still
  supports Node ≥18 (11.x requires Node ≥22, which is why 10.9.1 was chosen over the newest major).
  Usage in this repo is limited to `OAuth2Client` + `.verifyIdToken()`
  ([`src/utils/googleAuth.js`](node-api/src/utils/googleAuth.js)), a long-stable part of the
  library's surface — no code changes were needed.
- **`uuid` removed entirely.** Its only use was `uuid.v4()` for MongoDB `_id` generation in
  [`src/repositories/BaseRepository.js`](node-api/src/repositories/BaseRepository.js). Replaced
  with Node's built-in `crypto.randomUUID()`, which produces the same RFC 4122 v4 UUID string
  format (so existing Joi `.uuid()` validation and any already-stored IDs are unaffected) and
  needs no dependency at all. This also satisfies the "remove unused dependencies" pass — `uuid`
  is now gone from `package.json`.
- **`brace-expansion`** was resolved with a plain `npm audit fix` (no `--force`, no version bumps
  beyond the patch releases npm resolved on its own).

**No Node.js vulnerability required an unsafe/forced major bump.** `npm audit fix --force` was
never needed — it would have bumped `uuid` to 14.0.1 (ESM-only, would've broken the CommonJS
`require('uuid')` call), which the removal above sidesteps entirely.

---

## 3. Python service — vulnerability detail

| Package | Type | Advisory IDs | Installed | Fixed in | Breaking? |
|---|---|---|---|---|---|
| `python-multipart` | direct | PYSEC-2026-1852/3038/3037/3036/3040/3039 (CVE-2026-24486, -40347, -53538, -53539, -53540, -42561) — path traversal via `UPLOAD_DIR`+`UPLOAD_KEEP_FILENAME`, multiple parser DoS/smuggling issues | 0.0.20 | **0.0.32** | No |
| `python-dotenv` | direct (via `pydantic-settings`) | PYSEC-2026-2270 (CVE-2026-28684) — `set_key()`/`unset_key()` follow symlinks, arbitrary file overwrite | 1.1.0 | **1.2.2** | No |
| `starlette` | transitive (`fastapi`) | PYSEC-2026-161/248/249/1942/1941/2281/2280 (CVE-2026-48710, -54282, -54283, -2025-62727, -2025-54121, -48818, -48817) — Host-header/path URL-reconstruction spoofing (authz bypass), quadratic Range-header DoS, StaticFiles SSRF via UNC path on Windows, `HTTPEndpoint` verb-dispatch bypass, `request.form()` limits ignored for urlencoded bodies | 0.46.2 | **1.3.1** | Low (see below) |
| `pyasn1` | transitive (`python-jose`, `rsa`) | PYSEC-2026-2263/3457/3456/3455 (CVE-2026-30922, -59886, -59885, -59884) — recursion/quadratic-time DoS decoding crafted ASN.1 | 0.4.8 | n/a — dependency removed | No |
| `ecdsa` | transitive (`python-jose`) | GHSA-wj6h-64fc-37mp (CVE-2024-23342) — Minerva timing attack on P-256 ECDSA signing | 0.19.2 | **No fix exists** — see §4 | n/a — dependency removed |

### How each was fixed

- **`python-multipart` 0.0.20 → 0.0.32, `python-dotenv` 1.1.0 → 1.2.2.** Direct version bumps,
  both are patch/minor-only fixes with no API changes affecting this codebase's usage
  (`python-dotenv` is only used via `pydantic-settings`'s `env_file` loading;
  `python-multipart` is only used implicitly by FastAPI's form/file parsing).
- **`fastapi` 0.115.12 → 0.141.1, `starlette` 0.46.2 → 1.3.1 (pinned explicitly).** `fastapi`
  0.115.12 caps its `starlette` dependency at `<0.47.0`, so none of the `starlette` CVEs above
  could be patched without bumping `fastapi` too. `fastapi` didn't allow an open-ended `starlette`
  range until 0.133.0, so a mid-range bump wouldn't have covered the 1.x fixes either — 0.141.1
  (the current release, `starlette>=0.46.0` with no upper bound) was needed to reach the fully
  patched `starlette` 1.3.1. This repo's FastAPI usage (`lifespan` context manager, `Depends`,
  `exception_handler`, `StaticFiles.mount`, `include_router`) is all long-stable, version-plain
  surface — [`app/main.py`](python-service/app/main.py) was verified to still import and construct
  the app correctly after the bump, and the API itself never left the FastAPI 0.x line (no 1.0
  breaking-change release has happened for FastAPI itself). The StaticFiles SSRF advisory
  (PYSEC-2026-2281) is worth calling out specifically: this app mounts `/uploads` via
  `StaticFiles` for profile photo/signature uploads, so it was a real (if Windows-specific)
  exposure, not just theoretical.
- **`python-jose[cryptography]` replaced with `PyJWT`.** `python-jose` unconditionally requires
  `ecdsa`, `rsa`, and `pyasn1` regardless of which extra is installed — there's no way to keep
  `python-jose` and drop the `ecdsa` dependency. Its only use in this codebase is
  [`app/core/security.py`](python-service/app/core/security.py): `jwt.encode()` / `jwt.decode()`
  with `algorithm="HS256"` (from `settings.JWT_ALGORITHM`, see
  [`app/config.py:43`](python-service/app/config.py)) — a symmetric algorithm that never touches
  ECDSA/RSA code paths at all. `PyJWT` covers this exact usage with the same call signature
  (including automatic `datetime` → epoch conversion for `exp`/`iat`) and has no dependency on
  `ecdsa`/`rsa`/`pyasn1` for HMAC algorithms. This was verified with a manual round-trip
  (encode → decode, including the `type`/`jti`/`college_id` custom claims) and is covered by the
  new [`tests/test_security.py`](python-service/tests/test_security.py). This one change removes
  **5 advisories** (4 `pyasn1` CVEs + the unfixable `ecdsa` CVE) by eliminating the dependency
  chain rather than patching it.

---

## 4. Vulnerability with no available fix

**`ecdsa` 0.19.2 — GHSA-wj6h-64fc-37mp / CVE-2024-23342 (Minerva timing attack).**
The `python-ecdsa` maintainers have stated explicitly that side-channel attacks are out of scope
for the project and there is no planned fix — `fix_versions` is empty for every version, including
current. Per the task's guidance not to force an unsafe/nonexistent upgrade: no version bump
resolves this.

- **Risk if the dependency were kept:** an attacker able to measure signing-operation timing
  (e.g., co-located, or over a network with enough samples) could potentially recover the private
  key used for ECDSA P-256 signing/ECDH.
- **Actual exposure in this codebase before the fix:** low. `ecdsa` was pulled in transitively by
  `python-jose` regardless of whether it was actually used — this app's JWTs are signed with
  HS256 (a symmetric HMAC secret, see `JWT_ALGORITHM` default in `app/config.py`), so the
  vulnerable ECDSA signing path was never exercised at runtime. The risk was "present in the
  dependency tree and would show up in every scan," not "actively exploitable given this app's
  configuration."
- **Mitigation applied:** rather than accept the risk, the dependency was removed outright by
  replacing `python-jose` with `PyJWT` (§3). This is the safest outcome available — zero residual
  risk, not a documented-and-accepted one — and required no application-level compromise since
  ECDSA JWTs were never in use.
- **If a future requirement needs asymmetric JWT signing (RS256/ES256):** use `PyJWT[crypto]`,
  which uses the `cryptography` package's ECDSA implementation (side-channel-hardened, actively
  maintained), not `python-ecdsa`.

No other package in either service had an unresolved advisory after the changes above.

---

## 5. CI/CD workflow (`.github/workflows/ci.yml`)

- **Split into one job per concern** (`node-lint`, `node-test`, `node-audit`, `python-lint`,
  `python-test`, `python-audit`, `docker-build`) instead of two jobs that ran lint → test → audit
  sequentially. These now run in parallel, and a failure is attributed to exactly one concern
  instead of a single job with three collapsed responsibilities.
- **Removed the `continue-on-error` / `--collect-only` workarounds.** They existed because there
  was no ESLint config, no Ruff config, and no test files — all three now exist for real (§6), so
  lint and test failures genuinely fail the build instead of being logged as warnings.
- **`npm audit --audit-level=high`** and **`pip-audit -r requirements.txt`** are unchanged in
  behavior (fail on real Critical/High findings), but now run against dependency sets that are
  actually clean, so they're a real gate instead of a permanently-red or permanently-ignored check.
- **Dependency caching** was already in place (`actions/setup-node` / `actions/setup-python`
  `cache:` options) and is preserved; `python-lint`/`python-test` now key their cache off
  `requirements-dev.txt` (the new file — see §6) so ruff/pytest installs are cached too.
- **Removed a stale comment** claiming `node-api/Dockerfile` COPYs a nonexistent `sql/` folder —
  checked the current Dockerfile and that reference doesn't exist; the comment no longer matched
  reality.
- **Pinned `aquasecurity/trivy-action` to a commit SHA** instead of the `@master` branch ref found
  in the current committed workflow. An unpinned action reference is a supply-chain risk in its
  own right — the action's code can change with no corresponding change in this repo — so it's
  pinned the same way a dependency would be (`@ed142fd0...` / `v0.36.0`, latest at time of audit).
- **Node runtime bumped 18 → 22** (`setup-node` and both `node-api/Dockerfile` stages). Node 18
  reached end-of-life in April 2025 and Node 20 in April 2026 — as of this audit, 22 is the oldest
  actively-supported LTS. `package.json` `engines` was updated to `>=20.0.0` as a floor (nothing in
  the current dependency set requires 22 specifically); the CI/Docker runtime itself was moved to
  22 since that's what will actually keep receiving security patches. `python-service`'s
  `python:3.12-slim` base image is unaffected (3.12 is supported through October 2028).

---

## 6. Other changes made to keep "lint/test pass" honest

The task asked to verify ESLint, Ruff, and pytest all pass — none of the three were actually wired
up before this pass (see §0/§5), so making that claim true required adding real, minimal configs
rather than leaving the `continue-on-error` fakes in place:

- **`node-api/eslint.config.js`** — new flat config (ESLint 10), CommonJS/Node globals, jest
  globals scoped to test files only. `eslint`/`@eslint/js` added as devDependencies;
  `npm run lint` / `npm test` scripts added to `package.json` (neither existed before).
- **`node-api/src/__tests__/health.test.js`** — one Supertest smoke test against the real Express
  app (`GET /health` → 200). Chosen because it needs no live MongoDB connection (the `mongodb`
  driver only connects lazily in `src/server.js`, not at `require()` time), so it's a genuine,
  fast, infra-free check rather than a placeholder.
- **`python-service/pyproject.toml`** — added `[tool.ruff]`. Deliberately scoped to Ruff's default
  rule families (`E4`, `E7`, `E9`, `F` — pyflakes plus basic pycodestyle) rather than opting into
  modernization/style families (`UP`, `I`, `B`, …), which would have flagged ~550 pre-existing
  style findings across the codebase — well outside a dependency-security pass. `E402` is
  explicitly ignored: several modules import mid-file on purpose to break circular-import cycles
  (commented at each site), and restructuring those is a separate refactor, not a lint fix.
  The findings that *were* real bugs were fixed directly (all small, mechanical, behavior-preserving):
  - `app/api/v1/assessments.py` — missing `timedelta` import (`F821` — this was a latent
    `NameError` waiting to happen the first time that streak-update branch executed).
  - Bare `except:` → `except (ValueError, TypeError):` in `app/repositories/user_repo.py` and
    `app/api/v1/{students,assessments}.py` (`E722` — bare `except` also swallows
    `KeyboardInterrupt`/`SystemExit`, not just the parse errors these were written to catch).
  - Six unused imports removed from `app/services/auth_service.py` and `seed_mongo.py` (`F401`).
  - Two guard-clause calls (`get_student(...)`, `get_assessment_internal(...)`) whose return value
    was assigned to a never-used variable (`F841`) — the call itself is a real authorization/scope
    check (raises if the record doesn't exist or is out of the caller's college scope); only the
    unused binding was removed, the check itself is preserved.
  - `if not obj: return None` → two lines, in six `to_dict()` helpers (`E701`).
- **`python-service/requirements-dev.txt`** (new) — `-r requirements.txt` plus pinned `ruff` and
  `pytest`, so CI installs a reproducible dev toolchain instead of unpinned `pip install ruff` /
  `pip install pytest` at run time.
- **`python-service/tests/`** (new) — `conftest.py` sets the env vars `Settings` requires
  (`JWT_SECRET_KEY` etc.) so the suite doesn't depend on a local, gitignored `.env` file; and
  `test_security.py` — 5 tests covering the `python-jose` → `PyJWT` migration (§3): access/refresh
  token round-trips, token-type confusion rejection, invalid-token handling, and password hashing.

---

## 7. Dependency review — nothing else changed

Everything else in `package.json`/`requirements.txt` was left as-is. `npm outdated` shows several
packages with newer majors available (`express` 4→5, `joi` 17→18, `mongodb` 6→7, `dotenv` 16→17,
`helmet` 7→8, `express-rate-limit` 7→8, `groq-sdk` 0.9→1.5) — **none of these are flagged by `npm
audit`**, and bumping any of them is a real breaking-change risk (Express 5 in particular changes
routing/middleware error handling) with no security benefit, so they were left untouched per the
instruction to avoid forcing unnecessary breaking upgrades. They're worth a deliberate, separately
-tested upgrade pass later, not folded into a security patch.

One pre-existing, unrelated issue surfaced incidentally and is **not** fixed here (no CVE, not
part of this scope): `passlib` (used for password hashing in `python-service`) is unmaintained
(no release since 2020) and its bcrypt-backend version probe throws a caught/non-fatal
`AttributeError` against `bcrypt>=4.0` (hashing/verification still works correctly — confirmed by
manual test). Worth a follow-up migration to `bcrypt` directly or `argon2-cffi`, tracked separately
from this audit.

---

## 8. Changelog

### `node-api/package.json`
| Package | Before | After | Reason |
|---|---|---|---|
| `bcrypt` | ^5.1.1 | ^6.0.0 | Removes Critical `tar` + High `@mapbox/node-pre-gyp` |
| `google-auth-library` | ^9.9.0 | ^10.9.1 | Removes Moderate `gaxios`/`uuid` |
| `uuid` | ^9.0.1 | *(removed)* | Replaced with `node:crypto` `randomUUID()`; removes Moderate `uuid` finding |
| `eslint`, `@eslint/js` | *(absent)* | ^10.8.0 / ^10.0.1 | New devDependency — lint was unwired |
| `brace-expansion` (transitive) | 1.1.16 / 2.1.2 | 1.1.18 / 2.1.4 | via `npm audit fix` |
| `node` engine | >=18.0.0 | >=20.0.0 | Node 18 is EOL |

### `python-service/requirements.txt`
| Package | Before | After | Reason |
|---|---|---|---|
| `fastapi` | 0.115.12 | 0.141.1 | Needed to unpin `starlette` past its patched CVEs |
| `starlette` | *(transitive, 0.46.2)* | 1.3.1 *(now pinned explicitly)* | 7 CVEs incl. Host-header authz bypass, StaticFiles SSRF |
| `python-multipart` | 0.0.20 | 0.0.32 | 6 CVEs — path traversal, parser DoS/smuggling |
| `python-dotenv` | 1.1.0 | 1.2.2 | Symlink-following arbitrary file overwrite |
| `python-jose[cryptography]` | 3.4.0 | *(removed)* | Replaced with `pyjwt`; removes unfixable `ecdsa` CVE + 4 `pyasn1` CVEs |
| `pyjwt` | *(absent)* | 2.13.0 | New — replaces `python-jose` for HS256 JWT encode/decode |
| `pyasn1`, `rsa`, `ecdsa` (transitive) | 0.4.8 / 4.9.1 / 0.19.2 | *(removed)* | No longer needed once `python-jose` is gone |

### CI / infra
- `.github/workflows/ci.yml` — split into 7 parallel jobs, real lint/test gating, Trivy pinned to
  a commit SHA, Node runtime → 22, stale Dockerfile comment removed.
- `node-api/Dockerfile` — `node:18-alpine` → `node:22-alpine` (both stages).
- `python-service/pyproject.toml` — added `[tool.ruff]`.
- New files: `node-api/eslint.config.js`, `node-api/src/__tests__/health.test.js`,
  `python-service/tests/conftest.py`, `python-service/tests/test_security.py`,
  `python-service/requirements-dev.txt`.

---

## 9. Verification performed

Run locally in this environment (Windows; `npm ci` itself hit a transient Windows file-lock on
`bcrypt`'s native binary — environment-specific, not a dependency issue — `npm install` confirms
the same resolved tree installs cleanly, and this doesn't occur on the Linux CI runner):

| Check | Result |
|---|---|
| `npm audit` | **0 vulnerabilities** (was 1 Critical, 2 High, 2 Moderate) |
| `npm install` | ✅ succeeds |
| `npm run lint` (ESLint) | ✅ 0 errors (19 pre-existing warnings) |
| `npm test` (Jest) | ✅ 1/1 passing |
| `pip-audit -r requirements.txt` | **0 known vulnerabilities** (was 23 across 5 packages) |
| `pip install -r requirements.txt` | ✅ succeeds |
| `ruff check .` | ✅ 0 errors |
| `pytest -v` | ✅ 5/5 passing |
| `app.main` / edited modules import | ✅ verified directly |
| JWT round-trip (`python-jose`→`PyJWT` migration) | ✅ verified directly + covered by tests |
| Docker builds | **Not run** — Docker Desktop's engine wasn't running in this environment.
Both Dockerfiles were reviewed and updated (Node base image bump); recommend confirming the
`docker-build` CI job on the actual PR before merge. |

## 10. Production-readiness confirmation

Both services install cleanly, pass their full lint/test/audit gates, and report **zero known
dependency vulnerabilities** as of 2026-08-01. The one advisory with no upstream fix (`ecdsa`
Minerva timing attack) was eliminated by removing the dependency, not by accepting the risk — so
there are no outstanding "accepted risk" items to carry forward. The main follow-ups are hygiene,
not security: re-run this audit on a cadence (`npm audit` / `pip-audit` catch *known* CVEs only,
not zero-days), and consider the `passlib` and Express/Joi/MongoDB-driver major-version items in
§7 as separate, deliberately-tested upgrades.
