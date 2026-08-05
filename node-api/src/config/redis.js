// Shared ioredis client, used by the rate limiter store
// (middlewares/rateLimitStore.js). The WebSocket broadcaster
// (websocket/redisBroadcaster.js) uses its own dedicated pub/sub clients,
// because Redis subscribe-mode connections cannot be reused for publish/other
// commands.
//
// Entirely optional: with REDIS_URL unset, getRedisClient() returns null and
// every caller falls back to its single-instance-only behavior (in-memory
// rate limiting, in-process-only WS broadcast — both already correct for a
// single node-api instance, which is today's real deployment). Nothing in
// this app requires Redis to run.
const Redis = require('ioredis');
const logger = require('../utils/logger');

let client = null;
let attempted = false;

function getRedisClient() {
  if (client) return client;
  if (attempted) return null; // already tried and REDIS_URL was unset — don't recheck every call
  attempted = true;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  client = new Redis(url, {
    // Per-command timeout via limited retries — a rate-limit check or a chat
    // broadcast should never hang a request waiting on a wedged Redis; the
    // caller's own fallback (HybridRateLimitStore, in-memory broadcast)
    // takes over instead. Reconnection in the background is unaffected —
    // this only bounds how long any single command will keep retrying.
    maxRetriesPerRequest: 1,
    // Exponential-ish backoff, capped — avoids a reconnect storm hammering
    // Redis the moment it comes back up after an outage.
    retryStrategy: (attempts) => Math.min(attempts * 200, 5000),
    lazyConnect: false,
  });

  client.on('connect', () => logger.info('Redis: connected'));
  client.on('ready', () => logger.info('Redis: ready'));
  client.on('error', (err) => logger.warn('Redis: connection error', { error: err.message }));
  client.on('close', () => logger.warn('Redis: connection closed'));
  client.on('reconnecting', (delay) => logger.info('Redis: reconnecting', { delayMs: delay }));
  client.on('end', () => logger.warn('Redis: connection ended (giving up)'));

  return client;
}

// Checked on every call site rather than cached — reflects Redis's *current*
// reachability so a call made mid-outage (or mid-recovery) gets the right
// answer without needing its own reconnect-tracking logic.
function isRedisReady() {
  return client !== null && client.status === 'ready';
}

async function closeRedisClient() {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
    attempted = false;
  }
}

module.exports = { getRedisClient, isRedisReady, closeRedisClient };
