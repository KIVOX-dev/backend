const Redis = require('ioredis');
const logger = require('../utils/logger');

// Shared channel every node-api instance publishes to and subscribes on.
// Each instance's own `connections` map only ever holds sockets that
// literally opened a WS connection to *this* process — Redis is what lets a
// message reach the right user regardless of which instance they're
// connected to.
const CHANNEL = 'node-api:chat:broadcast';

// Satisfies the exact same three-method interface as InMemoryBroadcaster
// (register/remove/sendToUser — see broadcaster.js) so chatServer.js needs
// no changes to use this instead.
//
// Publish always goes to Redis, never straight to local sockets — every
// instance (including this one) receives its own publishes back through the
// subscription and delivers to whichever of its locally-connected sockets
// match, so a sender and receiver on the *same* instance still round-trip
// through Redis exactly like a cross-instance delivery would. That symmetry
// is deliberate: it means "does delivery work" only has one code path to
// verify, not a same-instance fast path plus a separate cross-instance one
// that could silently drift apart.
//
// Not implemented here, and deliberately not invented: presence sync (no
// online/offline indicator exists anywhere in this app today — nothing to
// preserve), and offline message buffering (messages are already durably
// written to MongoDB by chatServer.js before broadcast, so an offline
// recipient already sees them via GET /chat/history — a Redis-side buffer
// would just be a second, redundant copy of that).
class RedisBroadcaster {
  constructor(redisUrl) {
    this.connections = new Map(); // userId -> Set<socket>, LOCAL to this instance only
    this.ready = false;

    // ioredis requires a dedicated connection for subscribe mode — a client
    // that's SUBSCRIBEd can't also PUBLISH or run other commands.
    this.pub = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy: (attempts) => Math.min(attempts * 200, 5000),
    });
    this.sub = new Redis(redisUrl, {
      retryStrategy: (attempts) => Math.min(attempts * 200, 5000),
    });

    this.pub.on('error', (err) => logger.warn('Redis chat publisher error', { error: err.message }));
    this.sub.on('error', (err) => logger.warn('Redis chat subscriber error', { error: err.message }));
    this.sub.on('ready', () => {
      this.sub.subscribe(CHANNEL).catch((err) => logger.error('Redis chat subscribe failed', { error: err.message }));
    });

    this.sub.on('message', (channel, raw) => {
      if (channel !== CHANNEL) return;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        logger.warn('Failed to parse chat broadcast payload', { error: err.message });
        return;
      }
      this._deliverLocal(parsed.userId, parsed.message);
    });
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

  _deliverLocal(userId, message) {
    const sockets = this.connections.get(userId);
    if (!sockets) return;
    const payload = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  async sendToUser(userId, message) {
    try {
      await this.pub.publish(CHANNEL, JSON.stringify({ userId, message }));
    } catch (err) {
      // Redis is down: fall back to delivering only to sockets connected to
      // THIS instance — degrades to single-instance behavior for the
      // duration of the outage rather than silently dropping a message to
      // someone connected right here.
      logger.warn('Redis publish failed, falling back to local-only delivery', { error: err.message });
      this._deliverLocal(userId, message);
    }
  }

  async close() {
    await this.pub.quit().catch(() => this.pub.disconnect());
    await this.sub.quit().catch(() => this.sub.disconnect());
  }
}

module.exports = { RedisBroadcaster, CHANNEL };
