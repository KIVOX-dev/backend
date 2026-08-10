const http = require('http');
const WebSocket = require('ws');
const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression tests for the P1 finding in PROJECT_AUDIT_REPORT.md: the chat
// WebSocket accepted any client-supplied receiver_id with only a truthiness
// check — no verification the two accounts had any relationship at all —
// and set no maxPayload/content-length/rate limit. Fixed in
// websocket/chatServer.js (assertSameInstitution gate, MAX_WS_PAYLOAD_BYTES,
// MAX_MESSAGE_CONTENT_LENGTH, per-socket rate limit).
describe('Chat WebSocket: receiver scoping, payload caps, rate limiting', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let hashPassword;
  let server;
  let wss;
  let port;
  let apiPrefix;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, hashPassword } = await buildTestApp());
    apiPrefix = process.env.API_PREFIX || '/api/v1';
    const { attachChatServer } = require('../../websocket/chatServer');
    server = http.createServer(app);
    wss = attachChatServer(server);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    // wss.close() is what actually clears chatServer.js's heartbeat
    // setInterval (via its own 'close' listener) — closing only the
    // underlying http.Server leaves that interval running forever since ws
    // never learns the server it was handed is going away, which keeps the
    // Node process alive and Jest hanging after the last test finishes.
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    await teardownTestApp(database);
  });

  async function loginUser(role, institutionId) {
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role,
      institutionId,
      email: `chat-${role}-${Date.now()}-${Math.random()}@example.com`,
    });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    return { user, token: res.body.data.accessToken };
  }

  function connect(token) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${apiPrefix}/chat/ws`, [token]);
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    });
  }

  function nextMessage(socket) {
    return new Promise((resolve) => socket.once('message', (raw) => resolve(JSON.parse(raw.toString()))));
  }

  it('rejects a message to a receiver in a different institution', async () => {
    const institutionA = await seedInstitution(institutionRepository, { code: `WSA-${Date.now()}` });
    const institutionB = await seedInstitution(institutionRepository, { code: `WSB-${Date.now()}` });
    const sender = await loginUser('student', institutionA.id);
    const outsider = await loginUser('student', institutionB.id);

    const socket = await connect(sender.token);
    socket.send(JSON.stringify({ receiver_id: outsider.user.id, content: 'hello' }));
    const reply = await nextMessage(socket);

    expect(reply).toEqual({ type: 'error', message: 'You cannot message this user.' });
    socket.close();
  });

  it('delivers a message to a receiver in the same institution', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `WSC-${Date.now()}` });
    const sender = await loginUser('student', institution.id);
    const receiver = await loginUser('institution_admin', institution.id);

    const senderSocket = await connect(sender.token);
    const receiverSocket = await connect(receiver.token);

    const delivered = nextMessage(receiverSocket);
    senderSocket.send(JSON.stringify({ receiver_id: receiver.user.id, content: 'hi there' }));
    const received = await delivered;

    expect(received.content).toBe('hi there');
    expect(received.sender_id).toBe(sender.user.id);

    senderSocket.close();
    receiverSocket.close();
  });

  it('rejects content over the maximum message length', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `WSD-${Date.now()}` });
    const sender = await loginUser('student', institution.id);
    const receiver = await loginUser('institution_admin', institution.id);

    const socket = await connect(sender.token);
    socket.send(JSON.stringify({ receiver_id: receiver.user.id, content: 'x'.repeat(4001) }));
    const reply = await nextMessage(socket);

    expect(reply).toEqual({ type: 'error', message: 'Message is too long.' });
    socket.close();
  });

  it('rate-limits a burst of messages from one socket', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `WSE-${Date.now()}` });
    const sender = await loginUser('student', institution.id);
    const receiver = await loginUser('institution_admin', institution.id);

    const socket = await connect(sender.token);

    // MESSAGE_RATE_MAX is 20 within a 10s window — the 21st in quick
    // succession should be rejected as rate-limited, not silently dropped
    // for some other reason (each of the first 20 is a distinct valid
    // same-institution message, so there's nothing else that would reject them).
    for (let i = 0; i < 20; i += 1) {
      socket.send(JSON.stringify({ receiver_id: receiver.user.id, content: `msg-${i}` }));
    }
    socket.send(JSON.stringify({ receiver_id: receiver.user.id, content: 'one-too-many' }));
    const reply = await nextMessage(socket);

    expect(reply).toEqual({ type: 'error', message: 'You are sending messages too quickly.' });
    socket.close();
  });

  it('closes the connection when a frame exceeds the maxPayload cap', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `WSF-${Date.now()}` });
    const sender = await loginUser('student', institution.id);

    const socket = await connect(sender.token);
    const closed = new Promise((resolve) => socket.once('close', (code) => resolve(code)));

    socket.send(JSON.stringify({ receiver_id: 'someone', content: 'x'.repeat(20 * 1024) }));
    const code = await closed;

    expect(code).toBe(1009); // "Message too big"
  });
});
