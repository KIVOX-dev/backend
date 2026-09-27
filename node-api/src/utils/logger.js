const winston = require('winston');
const { redact, cloudSeverity } = require('./logRedaction');

// JSON to stdout: Cloud Run ships each line to Cloud Logging as a structured
// jsonPayload. Timestamps are ISO-8601 UTC. `redact` runs before anything is
// serialized — see utils/logRedaction.js for what it removes.
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    redact(),
    cloudSeverity(),
    winston.format.json()
  ),
  defaultMeta: { service: 'upscaler-ai-node-api' },
  transports: [new winston.transports.Console()],
});

module.exports = logger;
