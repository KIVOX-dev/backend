const { WebSocketServer } = require('ws');
const { verifyAccessToken } = require('../utils/jwt');
const messageRepository = require('../repositories/message.repository');
const userRepository = require('../repositories/user.repository');
const env = require('../config/env');
const logger = require('../utils/logger');

// In-memory connection registry: userId -> Set of open sockets (a user can
// have more than one tab/device open at once). Ported from python-service's
// core/websocket_manager.py.
//
// Single-process only, same as python-service's version — a message to a
// user connected to a DIFFERENT backend instance would never arrive. This
// was already today's ceiling (python-service is one process too), so it's
// not a regression; it's deferred to the Phase 11 performance checkpoint
// (Redis pub/sub) rather than solved here — see the Phase 3 migration plan's
// explicit note on this.
const connections = new Map();

function registerConnection(userId, socket) {
  if (!connections.has(userId)) connections.set(userId, new Set());
  connections.get(userId).add(socket);
}

function removeConnection(userId, socket) {
  const sockets = connections.get(userId);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) connections.delete(userId);
}

function sendToUser(userId, message) {
  const sockets = connections.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}

async function authenticate(requestUrl) {
  const { searchParams } = new URL(requestUrl, 'http://localhost');
  const token = searchParams.get('token');
  const payload = verifyAccessToken(token); // throws on invalid/missing — caller catches
  const user = await userRepository.findById(payload.sub);
  if (!user) throw new Error('User not found');
  return { id: user.id, role: user.role, name: user.full_name };
}

function attachChatServer(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: `${env.apiPrefix}/chat/ws`,
    // Auth runs during the HTTP upgrade, BEFORE the handshake completes —
    // the client's 'open' event does not fire until this resolves. This is
    // what actually matches python-service's behavior (which calls
    // `await get_current_user_ws(...)` before `websocket.accept()`); an
    // earlier version of this file authenticated inside the 'connection'
    // handler instead, which — unlike FastAPI's deferred-accept model — runs
    // AFTER the `ws` library has already completed the handshake. That let a
    // message sent immediately after connecting race ahead of the server's
    // own auth check and get silently dropped, caught via a live end-to-end
    // test (two real sockets, a real message, never delivered).
    verifyClient: (info, callback) => {
      authenticate(info.req.url)
        .then((user) => {
          info.req.chatUser = user;
          callback(true);
        })
        .catch(() => callback(false, 401, 'Invalid or missing token'));
    },
  });

  wss.on('connection', (socket, request) => {
    socket.user = request.chatUser;
    registerConnection(socket.user.id, socket);
    logger.info('WebSocket connected', { userId: socket.user.id });

    socket.on('message', async (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return; // silently ignored, matches python-service's JSONDecodeError handling
      }

      const { receiver_id: receiverId, content } = data;
      if (!receiverId || !content) return;

      let message;
      try {
        message = await messageRepository.create({
          sender_id: socket.user.id,
          sender_name: socket.user.name,
          sender_role: socket.user.role,
          receiver_id: receiverId,
          content,
        });
      } catch (err) {
        logger.error('Failed to persist chat message', { error: err.message });
        return;
      }

      // Echo to the sender (confirmation) and deliver to the receiver in
      // real-time if they're connected — durable either way via the DB write
      // above, so an offline receiver still sees it through /chat/history.
      sendToUser(socket.user.id, message);
      sendToUser(receiverId, message);
    });

    socket.on('close', () => {
      removeConnection(socket.user.id, socket);
      logger.info('WebSocket disconnected', { userId: socket.user.id });
    });
  });

  return wss;
}

module.exports = { attachChatServer };
