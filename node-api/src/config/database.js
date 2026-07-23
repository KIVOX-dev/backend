// PostgreSQL connection pool (Google Cloud SQL) using the `pg` package.
// This is the ONLY module in the codebase allowed to talk to the database driver directly —
// everything else goes through repositories, which use pool.query()/getClient() from here.
const { Pool } = require('pg');
const env = require('./env');
const logger = require('../utils/logger');

const poolConfig = env.db.connectionString
  ? {
      connectionString: env.db.connectionString,
      ssl: env.db.ssl ? { rejectUnauthorized: false } : false,
    }
  : {
      host: env.db.host,
      port: env.db.port,
      database: env.db.database,
      user: env.db.user,
      password: env.db.password,
      ssl: env.db.ssl ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool({
  ...poolConfig,
  max: env.db.poolMax,
  idleTimeoutMillis: env.db.idleTimeoutMillis,
  connectionTimeoutMillis: env.db.connectionTimeoutMillis,
});

pool.on('error', (err) => {
  // Errors on idle clients (e.g. connection dropped by the server) must not crash the process.
  logger.error('Unexpected error on idle PostgreSQL client', { error: err.message });
});

async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  logger.debug('executed query', { text, duration: Date.now() - start, rows: result.rowCount });
  return result;
}

async function getClient() {
  // Use for multi-statement transactions: const client = await getClient(); try { ... } finally { client.release(); }
  const client = await pool.connect();
  return client;
}

async function withTransaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, getClient, withTransaction };
