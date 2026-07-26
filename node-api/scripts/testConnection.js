// Verifies the Node backend can reach MongoDB with the current .env.node config.
// Usage: npm run db:test
const { connect, getDb, close } = require('../src/config/database');
const logger = require('../src/utils/logger');

async function main() {
  try {
    await connect();
    const db = getDb();

    const ping = await db.command({ ping: 1 });
    logger.info('Database connection OK', { ping, database: db.databaseName });

    const collections = await db.listCollections().toArray();
    logger.info(`Found ${collections.length} existing collection(s)`, {
      collections: collections.map((c) => c.name),
    });
    if (collections.length === 0) {
      logger.warn('No collections yet — run: npm run db:setup-indexes (creates them with their indexes)');
    }

    process.exit(0);
  } catch (err) {
    logger.error('Database connection FAILED', { error: err.message });
    process.exit(1);
  } finally {
    await close();
  }
}

main();
