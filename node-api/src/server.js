const app = require('./app');
const env = require('./config/env');
const { pool } = require('./config/database');
const logger = require('./utils/logger');

const server = app.listen(env.port, () => {
  logger.info(`Skillovate Node API listening on port ${env.port} [${env.nodeEnv}]`);
});

// Graceful shutdown: stop accepting new connections, then drain the DB pool,
// so in-flight requests and pooled connections aren't dropped mid-transaction.
async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await pool.end();
    logger.info('Shutdown complete');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || reason });
});
