const { WebSocketServer } = require('ws');
const { verifyAccessToken } = require('../utils/jwt');
const messageRepository = require('../repositories/message.repository');
const userRepository = require('../repositories/user.repository');
const env = require('../config/env');
const logger = require('../utils/logger');
const { broadcaster } = require('./broadcaster');
const { assertSameInstitution } = require('../utils/authz');

// Hard cap on a single WebSocket frame — the ws library's own default
// (100 MiB) is meant for binary/streaming use cases, not a JSON chat
// message; leaving it at that default is a low-effort memory-pressure
// vector for something this app never needs more than a few KB for. See
// PROJECT_AUDIT_REPORT.md P1-8.
const MAX_WS_PAYLOAD_BYTES = 16 * 1024;

// Independent of the frame-size cap above: content is still capped
// per-field so a technically-small-enough frame can't smuggle an
// unreasonably long chat message (matches typical chat-app limits, and the
// same order of magnitude as other free-text fields validated elsewhere in
// this app, e.g. resumeBuilder.validation's textarea caps).
const MAX_MESSAGE_CONTENT_LENGTH = 4000;

// Per-socket sliding-window rate limit — deliberately in-memory, not the
// Redis-backed HybridRateLimitStore middlewares/rateLimiter.js uses for HTTP
// routes: the chat broadcaster itself is already documented as
// single-instance/in-memory only (see broadcaster.js), so a per-process
// limiter here isn't introducing a new scaling limitation, just matching the
// one that already exists for this feature.
const MESSAGE_RATE_WINDOW_MS = 10_000;
const MESSAGE_RATE_MAX = 20;

function isRateLimited(socket) {
  const now = Date.now();
  socket.messageTimestamps = (socket.messageTimestamps || []).filter((t) => now - t < MESSAGE_RATE_WINDOW_MS);
  if (socket.messageTimestamps.length >= MESSAGE_RATE_MAX) return true;
  socket.messageTimestamps.push(now);
  return false;
}

// ws-level ping/pong (this section) is purely for the SERVER to detect and
// clean up dead sockets — a client whose TCP connection dropped without a
// clean close frame (e.g. laptop sleep, wifi drop) never fires 'close' on
// its own. Distinct from the app-level {type:'ping'/'pong'} messages below,
// which exist because the browser's native WebSocket API has no JS-visible
// ping/pong events at all — the client can't tell whether the *server* is
// still alive without something at the message layer to ask.
const HEARTBEAT_INTERVAL_MS = 30_000;

async function authenticate(request) {
  // Primary: the token as a WS subprotocol (`new WebSocket(url, [token])` on
  // the client — see PlatformChat.tsx). Browsers don't allow custom headers
  // on a WebSocket handshake from JS, so a subprotocol is the only
  // client-controlled part of the handshake that isn't the URL itself; it
  // arrives as the standard `Sec-WebSocket-Protocol` header. This is why the
  // token no longer needs to sit in the URL (and therefore in server access
  // logs, browser history, and Referer headers on any request the page makes
  // afterward) the way the old `?token=` query string did.
  //
  // Fallback: the old `?token=` query string, kept only so a client that
  // hasn't picked up the subprotocol change yet still works during rollout.
  const protocolHeader = request.headers['sec-websocket-protocol'];
  const subprotocolToken = protocolHeader ? protocolHeader.split(',')[0].trim() : null;
  const { searchParams } = new URL(request.url, 'http://localhost');
  const queryToken = searchParams.get('token');
  const token = subprotocolToken || queryToken;

  // Migration tracking (Phase 1 — see docs/websocket.md): every client is
  // expected to be on the subprotocol path already (this session's own
  // frontend switch), so any query-string usage past this point is either a
  // client that missed the deploy or a caller outside this codebase. Logged,
  // not blocked — safe to grep/alert on before Phase 3 (deleting the
  // fallback) actually removes it.
  if (!subprotocolToken && queryToken) {
    logger.warn('WebSocket: legacy ?token= query-string auth used', {
      userAgent: request.headers['user-agent'],
      origin: request.headers.origin,
    });
  }

  const payload = verifyAccessToken(token); // throws on invalid/missing — caller catches
  const user = await userRepository.findById(payload.sub);
  if (!user) throw new Error('User not found');
  // institutionId is required by the receiver-scoping check in the
  // 'message' handler below (see assertSameInstitution) — not previously
  // included here since nothing needed it before that check existed.
  return { id: user.id, role: user.role, name: user.full_name, institutionId: user.institution_id };
}

function attachChatServer(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: `${env.apiPrefix}/chat/ws`,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
    // Echoes the client's offered subprotocol back — required by the WS spec
    // whenever the client sends Sec-WebSocket-Protocol at all; some clients
    // (browsers included) abort the handshake if the server accepts the
    // upgrade but doesn't select one of the offered protocols. The
    // subprotocol string itself is the token (see authenticate() above), so
    // there's nothing to actually choose between — just confirm the first one.
    handleProtocols: (protocols) => (protocols.size > 0 ? protocols.values().next().value : false),
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
      authenticate(info.req)
        .then((user) => {
          info.req.chatUser = user;
          callback(true);
        })
        .catch(() => callback(false, 401, 'Invalid or missing token'));
    },
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (socket.isAlive === false) {
        logger.info('WebSocket heartbeat timeout — terminating', { userId: socket.user?.id });
        return socket.terminate();
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (socket, request) => {
    socket.user = request.chatUser;
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    // Without this, an 'error' event on any one client's socket (e.g. the
    // MAX_WS_PAYLOAD_BYTES violation above, or any other protocol-level
    // fault the ws library surfaces this way) is an unhandled EventEmitter
    // error — which throws and would crash the entire node-api process for
    // every connected user, not just the one whose frame triggered it.
    // Caught by chatSecurity.test.js's maxPayload test, which failed with
    // exactly that unhandled-error crash before this handler existed.
    socket.on('error', (err) => {
      logger.warn('WebSocket error', { userId: socket.user?.id, error: err.message });
    });

    broadcaster.register(socket.user.id, socket);
    logger.info('WebSocket connected', { userId: socket.user.id });

    socket.on('message', async (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return; // silently ignored, matches python-service's JSONDecodeError handling
      }

      // App-level heartbeat reply — see the HEARTBEAT_INTERVAL_MS comment
      // above for why this exists alongside ws-level ping/pong.
      if (data.type === 'ping') {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      const { receiver_id: receiverId, content } = data;
      if (!receiverId || !content || typeof content !== 'string') return;

      if (isRateLimited(socket)) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'error', message: 'You are sending messages too quickly.' }));
        }
        return;
      }

      if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'error', message: 'Message is too long.' }));
        }
        return;
      }

      // Same scoping as the contact directory this receiver_id would have
      // come from (PlatformChat.tsx fetches contacts from GET /users or
      // GET /students, both already institution-scoped) — this endpoint
      // used to accept any receiver_id with no check that the two accounts
      // have any relationship at all. See PROJECT_AUDIT_REPORT.md P1-8.
      const receiver = await userRepository.findById(receiverId);
      if (!receiver) return;
      try {
        assertSameInstitution(socket.user, receiver);
      } catch {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'error', message: 'You cannot message this user.' }));
        }
        return;
      }

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
      broadcaster.sendToUser(socket.user.id, message);
      broadcaster.sendToUser(receiverId, message);
    });

    socket.on('close', () => {
      broadcaster.remove(socket.user.id, socket);
      logger.info('WebSocket disconnected', { userId: socket.user.id });
    });
  });

  return wss;
}

module.exports = { attachChatServer };
