// Verifies the Node backend can reach PostgreSQL/Cloud SQL with the current .env.node config.
// Usage: npm run db:test
const { pool, query } = require('../src/config/database');
const logger = require('../src/utils/logger');

async function main() {
  try {
    const { rows } = await query('SELECT NOW() AS server_time, version() AS pg_version');
    logger.info('Database connection OK', rows[0]);

    const tableCheck = await query(
      `SELECT COUNT(*)::int AS count FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'`
    );
    if (tableCheck.rows[0].count === 0) {
      logger.warn('Connected, but schema not found. Run: psql -f sql/schema.sql "$DATABASE_URL"');
    } else {
      logger.info('Schema check OK: users table exists');
    }

    process.exit(0);
  } catch (err) {
    logger.error('Database connection FAILED', { error: err.message });
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
