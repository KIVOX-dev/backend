const express = require('express');
const database = require('../config/database');
const { getRedisClient, isRedisReady } = require('../config/redis');
const { broadcaster } = require('../websocket/broadcaster');
const logger = require('../utils/logger');

const router = express.Router();

// Liveness — "is the process alive enough to answer HTTP at all". Checks
// nothing downstream on purpose: a Kubernetes liveness probe restarts the
// pod on failure, which would just cause a restart loop if it also depended
// on Mongo/Redis being reachable during, say, a Mongo Atlas maintenance
// window. That's what /health/ready is for.
router.get('/live', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Readiness — "can this instance actually serve traffic right now". A load
// balancer/orchestrator uses this to decide whether to route requests here,
// not whether to restart the process. Mongo is required (the app can't
// function without it); Redis is optional (see config/redis.js) — its
// absence or unreachability is reported but never fails readiness, since
// every Redis-backed feature already degrades gracefully on its own.
router.get('/ready', async (req, res) => {
  const checks = {};
  let healthy = true;

  try {
    checks.mongo = { status: 'ok', latencyMs: Math.round((await database.ping()) * 100) / 100 };
  } catch (err) {
    // /health/ready is unauthenticated (a load balancer/orchestrator probe)
    // — the same discipline as errorHandler.js applies: never put a raw
    // driver error message in a public response. Mongo connection errors
    // can include host/auth details a client has no business seeing.
    logger.error('Readiness check: Mongo unreachable', { error: err.message });
    checks.mongo = { status: 'error' };
    healthy = false;
  }

  if (process.env.REDIS_URL) {
    const client = getRedisClient();
    if (client && isRedisReady()) {
      try {
        const start = process.hrtime.bigint();
        await client.ping();
        checks.redis = { status: 'ok', latencyMs: Math.round((Number(process.hrtime.bigint() - start) / 1e6) * 100) / 100 };
      } catch (err) {
        // Redis being down doesn't fail readiness — every Redis-backed
        // feature (rate limiting, chat broadcast) already has a working
        // in-memory/local fallback. Reported for visibility, not gating —
        // and, same reasoning as the Mongo branch above, logged server-side
        // rather than echoed to this unauthenticated endpoint's response.
        logger.warn('Readiness check: Redis unreachable', { error: err.message });
        checks.redis = { status: 'degraded' };
      }
    } else {
      checks.redis = { status: 'connecting' };
    }
  } else {
    checks.redis = { status: 'not_configured' };
  }

  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ready' : 'not_ready', checks });
});

// Plain JSON operational snapshot — not a Prometheus text-format exporter
// (no prom-client dependency here), just the numbers most useful for a quick
// "is something wrong" check or for a log/monitoring agent to scrape and
// forward. WebSocket connection counts are *local to this instance* even
// when Redis-backed broadcasting is active (see websocket/broadcaster.js) —
// aggregate across instances at the infra layer if that total matters.
router.get('/metrics', (req, res) => {
  const memory = process.memoryUsage();
  let wsUsers = 0;
  let wsSockets = 0;
  for (const sockets of broadcaster.connections.values()) {
    wsUsers += 1;
    wsSockets += sockets.size;
  }

  res.status(200).json({
    uptimeSeconds: process.uptime(),
    memory: {
      rssMb: Math.round((memory.rss / 1024 / 1024) * 10) / 10,
      heapUsedMb: Math.round((memory.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotalMb: Math.round((memory.heapTotal / 1024 / 1024) * 10) / 10,
    },
    websocket: { connectedUsers: wsUsers, connectedSockets: wsSockets },
    redis: { configured: Boolean(process.env.REDIS_URL), ready: isRedisReady() },
    nodeEnv: process.env.NODE_ENV || 'development',
  });
});

module.exports = router;
