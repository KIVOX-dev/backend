const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { connect, close } = require('./config/database');
const { attachChatServer } = require('./websocket/chatServer');
const { broadcaster } = require('./websocket/broadcaster');
const { closeRedisClient } = require('./config/redis');
const logger = require('./utils/logger');

// Created explicitly (rather than via app.listen()) so the WebSocket server
// can attach to the same underlying HTTP server instead of opening a second
// port — ws upgrades share the port/TLS termination Cloud Run already expects.
const server = http.createServer(app);
attachChatServer(server);

async function start() {
  await connect(); // must succeed before we accept traffic
  server.listen(env.port, () => {
    logger.info(`UpScaler-AI Node API listening on port ${env.port} [${env.nodeEnv}]`);
  });
}

// Graceful shutdown: stop accepting new connections, then close the Mongo client,
// so in-flight requests aren't dropped mid-request.
async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  server?.close(async () => {
    await Promise.allSettled([close(), broadcaster.close(), closeRedisClient()]);
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

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});
