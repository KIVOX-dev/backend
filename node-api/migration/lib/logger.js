// Standalone logger for the migration tool. Does not reuse src/utils/logger.js
// on purpose (that one is fine to reuse, but keeping this tool fully
// self-contained means it has zero import path back into src/, reinforcing
// that it's not part of the running application). Every entry is passed
// through redact() so a URI or token can never end up in a log line.
const { redact, redactError } = require('./redact');

function timestamp() {
  return new Date().toISOString();
}

function log(level, message, meta) {
  const entry = { level, message, timestamp: timestamp() };
  if (meta !== undefined) entry.meta = redact(meta);
  console.log(JSON.stringify(entry));
}

module.exports = {
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, err, meta) =>
    log('error', message, { ...(meta || {}), error: redactError(err) }),
};
