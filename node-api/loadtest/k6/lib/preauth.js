#!/usr/bin/env node
// Pre-authenticates a pool of dedicated load-test accounts ONE TIME, before
// the k6 run, and caches the resulting access/refresh tokens to disk.
//
// Why this exists: node-api's authLimiter (src/middlewares/rateLimiter.js)
// caps /auth/login (and /register, /google, /refresh, /forgot-password,
// /reset-password, /change-initial-password, /verify-email) at 20 requests
// per 15 minutes PER SOURCE IP by default — shared across ALL of those
// routes in one bucket. A load generator running from one machine/IP will
// blow through that in seconds if the k6 script logs in per-iteration. This
// script logs in once per account, paced, so the actual k6 run never calls
// /auth/login at all (it only occasionally calls /auth/refresh, which the
// k6 script already jitters across VUs — see site-journey.js).
//
// Usage:
//   node lib/preauth.js \
//     --api https://node-api-xxx.asia-south1.run.app/api/v1 \
//     --accounts ./accounts.json \
//     --out ./tokens.json \
//     [--delay-ms 3000]
//
// accounts.json shape: [{ "email": "...", "password": "...", "role": "student" }, ...]
// (see ../accounts.example.json)
//
// IMPORTANT: if accounts.length > AUTH_RATE_LIMIT_MAX (default 20) on the
// target server, this script WILL hit 429s partway through. It backs off
// using the Retry-After header and keeps going, but for anything beyond a
// couple dozen accounts you almost certainly want to temporarily raise
// AUTH_RATE_LIMIT_MAX (and RATE_LIMIT_MAX) on the target Cloud Run service
// for the duration of the test window instead of waiting out real 15-minute
// windows serially. See ../README.md "Rate limits" section.

const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : def;
  };
  return {
    api: get('--api'),
    accountsFile: get('--accounts', './accounts.json'),
    outFile: get('--out', './tokens.json'),
    delayMs: Number(get('--delay-ms', '3000')),
  };
}

function postJson(urlStr, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch (_) {
            // ignore parse failure, handled by caller via status check
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { api, accountsFile, outFile, delayMs } = parseArgs();
  if (!api) {
    console.error('Usage: node preauth.js --api <API_URL> --accounts <accounts.json> --out <tokens.json>');
    process.exit(1);
  }

  const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.error(`${accountsFile} must be a non-empty JSON array — see accounts.example.json`);
    process.exit(1);
  }

  console.log(`Pre-authenticating ${accounts.length} account(s) against ${api} ...`);
  if (accounts.length > 20) {
    console.warn(
      `WARNING: ${accounts.length} accounts > authLimiter's default 20/15min budget. ` +
        'Expect 429s partway through unless AUTH_RATE_LIMIT_MAX has been raised on the target service.'
    );
  }

  const tokens = [];
  for (let i = 0; i < accounts.length; i++) {
    const acct = accounts[i];
    let res = await postJson(`${api}/auth/login`, { email: acct.email, password: acct.password });

    if (res.status === 429) {
      const retryAfterS = Number(res.headers['retry-after']) || 60;
      console.warn(`  [${i + 1}/${accounts.length}] 429 for ${acct.email} — waiting ${retryAfterS}s and retrying once`);
      await sleep(retryAfterS * 1000);
      res = await postJson(`${api}/auth/login`, { email: acct.email, password: acct.password });
    }

    if (res.status !== 200 || !res.body) {
      console.error(`  [${i + 1}/${accounts.length}] FAILED for ${acct.email}: status=${res.status} body=${JSON.stringify(res.body)}`);
      continue;
    }

    const data = res.body.data || res.body;
    const accessToken = data.access_token || data.accessToken;
    const refreshToken = data.refresh_token || data.refreshToken;
    const userId = data.user?.id;
    const role = data.user?.role || acct.role;

    if (!accessToken || !refreshToken) {
      console.error(`  [${i + 1}/${accounts.length}] No tokens in response for ${acct.email} — check credentials/response shape`);
      continue;
    }

    tokens.push({ email: acct.email, accessToken, refreshToken, userId, role, expiresInMs: 15 * 60 * 1000 });
    console.log(`  [${i + 1}/${accounts.length}] OK  ${acct.email} (role=${role})`);

    if (i < accounts.length - 1) await sleep(delayMs);
  }

  fs.writeFileSync(outFile, JSON.stringify(tokens, null, 2));
  console.log(`\nWrote ${tokens.length}/${accounts.length} token(s) to ${outFile}`);
  if (tokens.length === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('preauth.js failed:', err);
  process.exit(1);
});
