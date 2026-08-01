// Pluggable message-broadcast interface, split out of chatServer.js so the
// connection registry isn't hardwired into the WS handshake/message logic.
// The in-memory implementation below only reaches sockets connected to THIS
// process; with REDIS_URL set, `broadcaster` is a RedisBroadcaster instead
// (see redisBroadcaster.js) — same three-method shape (register/remove/
// sendToUser), so nothing in chatServer.js changes either way.
const logger = require('../utils/logger');

class InMemoryBroadcaster {
  constructor() {
    this.connections = new Map(); // userId -> Set<socket>
  }

  register(userId, socket) {
    if (!this.connections.has(userId)) this.connections.set(userId, new Set());
    this.connections.get(userId).add(socket);
  }

  remove(userId, socket) {
    const sockets = this.connections.get(userId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) this.connections.delete(userId);
  }

  sendToUser(userId, message) {
    const sockets = this.connections.get(userId);
    if (!sockets) return;
    const payload = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  // No-op — nothing to close for the in-memory case. Exists so callers
  // (server.js's shutdown handler) don't need to branch on which
  // implementation is active.
  async close() {}
}

let broadcaster;
if (process.env.REDIS_URL) {
  const { RedisBroadcaster } = require('./redisBroadcaster');
  broadcaster = new RedisBroadcaster(process.env.REDIS_URL);
  logger.info('Chat broadcaster: Redis-backed (multi-instance)');
} else {
  broadcaster = new InMemoryBroadcaster();
  logger.info('Chat broadcaster: in-memory (single-instance only)');
}

module.exports = { broadcaster };
