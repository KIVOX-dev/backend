const logger = require('./logger');

// Transient-error heuristics for the MongoDB wire protocol / network layer.
// Anything else (validation errors, duplicate key on a *different* value,
// auth failures) is a real problem and should surface immediately, not be
// retried into a longer failure.
const TRANSIENT_CODES = new Set([
  6, // HostUnreachable
  7, // HostNotFound
  89, // NetworkTimeout
  91, // ShutdownInProgress
  189, // PrimarySteppedDown
  9001, // SocketException
  10107, // NotMaster
  11600, // InterruptedAtShutdown
  11602, // InterruptedDueToReplStateChange
  13435, // NotMasterNoSlaveOk
  13436, // NotMasterOrSecondary
]);

function isTransient(err) {
  if (!err) return false;
  if (err.hasErrorLabel && (err.hasErrorLabel('TransientTransactionError') || err.hasErrorLabel('RetryableWriteError'))) {
    return true;
  }
  if (TRANSIENT_CODES.has(err.code)) return true;
  return /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|topology was destroyed|socket/i.test(err.message || '');
}

// Exponential backoff with jitter. maxRetries=5, baseDelayMs=500 gives delays
// of roughly 500-1000ms, 1000-2000ms, 2000-4000ms, 4000-8000ms, 8000-16000ms.
async function withRetry(fn, { maxRetries, baseDelayMs, label }) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries || !isTransient(err)) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1) * (1 + Math.random() * 0.5);
      logger.warn(`Transient error, retrying`, {
        label,
        attempt,
        maxRetries,
        delayMs: Math.round(delay),
        errorMessage: err.message,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

module.exports = { withRetry, isTransient };
