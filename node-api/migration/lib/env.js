// Env loading for the migration tooling ONLY. Deliberately separate from
// src/config/env.js so nothing here can ever be require()'d by the running
// application — this is a standalone CLI tool, never imported by src/server.js.
//
// Reads TWO env files:
//  - .env.node (existing app config)      -> source MongoDB, read-only usage
//  - .env.migration (new, gitignored)     -> Firestore MongoDB-compatibility target
require('dotenv').config({ path: '.env.node' });
require('dotenv').config({ path: '.env.migration' });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `See node-api/migration/.env.migration.example for what's needed.`
    );
  }
  return value;
}

module.exports = {
  source: {
    // Reuses the app's existing MONGODB_URI — this tool never writes to the
    // source, so no separate read-only credential is required, but see
    // lib/sourceDb.js: only read methods are ever exposed from that module.
    uri: required('MONGODB_URI'),
    dbName: process.env.MONGODB_DB_NAME || 'upscaler_ai_node',
  },
  target: {
    // Google-generated OIDC connection string for Firestore with MongoDB
    // compatibility. Never log this value — see lib/redact.js.
    uri: required('FIRESTORE_MONGODB_URI'),
  },
  batchSize: parseInt(process.env.MIGRATION_BATCH_SIZE, 10) || 500,
  batchDelayMs: parseInt(process.env.MIGRATION_BATCH_DELAY_MS, 10) || 0,
  maxRetries: parseInt(process.env.MIGRATION_MAX_RETRIES, 10) || 5,
  retryBaseDelayMs: parseInt(process.env.MIGRATION_RETRY_BASE_DELAY_MS, 10) || 500,
};
