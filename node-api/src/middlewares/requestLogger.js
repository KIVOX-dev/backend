const logger = require('../utils/logger');

// One structured JSON log line per completed request — method, path, status,
// latency, request id, and (when authenticated) the actor. Distinct from
// morgan (app.js) which stays for human-readable console access logs in
// dev; this is the machine-parseable counterpart a log aggregator (or the
// latency-percentile calculation in Part 13's benchmarking) actually needs —
// morgan's text format isn't reliably parseable for that.
module.exports = function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const entry = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userId: req.user?.id,
      role: req.user?.role,
    };
    if (res.statusCode >= 500) {
      logger.error('request', entry);
    } else if (res.statusCode >= 400) {
      logger.warn('request', entry);
    } else {
      logger.info('request', entry);
    }
  });

  next();
};
