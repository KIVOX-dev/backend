// Standalone background worker (production): `npm run worker`. Runs the
// notification email queue consumer without serving HTTP, so email sending
// never competes with API traffic. In local dev the same worker can instead
// run inside the API process (NOTIFICATION_WORKER_MODE=inprocess, see server.js).
const { connect, close } = require('./config/database');
const { startWorker, closeNotificationQueue } = require('./queues/emailNotification.queue');
const logger = require('./utils/logger');

async function start() {
  await connect();
  const worker = await startWorker();
  if (!worker) {
    logger.error('Worker needs REDIS_URL to consume the queue');
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down worker`);
  await Promise.allSettled([closeNotificationQueue(), close()]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || reason });
});

start().catch((err) => {
  logger.error('Failed to start worker', { error: err.message });
  process.exit(1);
});
