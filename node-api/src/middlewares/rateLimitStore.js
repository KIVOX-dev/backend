const { getRedisClient, isRedisReady } = require('../config/redis');
const logger = require('../utils/logger');

// express-rate-limit Store implementation (see that package's `Store` type)
// backed by Redis when reachable, an in-process Map otherwise — checked on
// every increment, not just at startup, so this self-heals the moment Redis
// reconnects without needing its own health-polling loop.
//
// Falling back to per-instance in-memory counting during a Redis outage
// means limits are enforced per-instance instead of globally for as long as
// the outage lasts — looser than the intended global limit, but still real
// protection, and far better than either failing the request outright or
// (the actual dangerous failure mode) silently disabling rate limiting
// entirely until someone notices.
class HybridRateLimitStore {
  constructor({ prefix, windowMs }) {
    this.prefix = prefix;
    this.windowMs = windowMs;
    // Redis-backed counts are shared across every node-api instance; the
    // in-memory fallback is not — express-rate-limit's own double-counting
    // guard only cares whether *this* value is stable, so leave it at its
    // conservative (Redis-shaped) setting rather than flip-flopping it.
    this.localKeys = false;
    this.memory = new Map(); // key -> { count, resetTime: epoch ms }
  }

  _memoryIncrement(key) {
    const now = Date.now();
    const existing = this.memory.get(key);
    if (!existing || existing.resetTime <= now) {
      const resetTime = now + this.windowMs;
      this.memory.set(key, { count: 1, resetTime });
      return { totalHits: 1, resetTime: new Date(resetTime) };
    }
    existing.count += 1;
    return { totalHits: existing.count, resetTime: new Date(existing.resetTime) };
  }

  async increment(key) {
    const client = getRedisClient();
    if (!client || !isRedisReady()) {
      return this._memoryIncrement(key);
    }
    try {
      const redisKey = this.prefix + key;
      const count = await client.incr(redisKey);
      let ttl = await client.pttl(redisKey);
      if (ttl < 0) {
        // First hit in this window (or the key somehow lost its TTL) — set one.
        await client.pexpire(redisKey, this.windowMs);
        ttl = this.windowMs;
      }
      return { totalHits: count, resetTime: new Date(Date.now() + ttl) };
    } catch (err) {
      logger.warn('Redis rate-limit increment failed, using in-memory fallback for this request', {
        error: err.message,
      });
      return this._memoryIncrement(key);
    }
  }

  async decrement(key) {
    const client = getRedisClient();
    if (client && isRedisReady()) {
      try {
        await client.decr(this.prefix + key);
        return;
      } catch (err) {
        logger.warn('Redis rate-limit decrement failed', { error: err.message });
      }
    }
    const existing = this.memory.get(key);
    if (existing) existing.count = Math.max(0, existing.count - 1);
  }

  async resetKey(key) {
    const client = getRedisClient();
    if (client && isRedisReady()) {
      try {
        await client.del(this.prefix + key);
      } catch (err) {
        logger.warn('Redis rate-limit resetKey failed', { error: err.message });
      }
    }
    this.memory.delete(key);
  }
}

module.exports = { HybridRateLimitStore };
