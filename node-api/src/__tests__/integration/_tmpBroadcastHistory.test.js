const http = require('http');
const request = require('supertest');
const WebSocket = require('ws');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');

describe('Broadcast history (throwaway verification)', () => {
  let app, database, server, port, userRepository, hashPassword;

  beforeAll(async () => {
    ({ app, database } = await buildTestApp());
    userRepository = require('../../repositories/user.repository');
    ({ hashPassword } = require('../../utils/password'));
    const { attachChatServer } = require('../../websocket/chatServer');
    server = http.createServer(app);
    attachChatServer(server);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    server.close();
    await teardownTestApp(database);
  });

  it('reconstructs one broadcast event from N fanned-out copies, scoped to the sender', async () => {
    const pw = await hashPassword('Sup3rSecret!');
    const admin = await userRepository.create({ email: 'bcast-admin@example.com', password_hash: pw, full_name: 'Admin', role: 'institution_admin', institution_id: 'inst-1' });
    const s1 = await userRepository.create({ email: 'bcast-s1@example.com', password_hash: pw, full_name: 'S1', role: 'student', institution_id: 'inst-1' });
    const s2 = await userRepository.create({ email: 'bcast-s2@example.com', password_hash: pw, full_name: 'S2', role: 'student', institution_id: 'inst-1' });

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'bcast-admin@example.com', password: 'Sup3rSecret!' }).expect(200);
    const token = login.body.data.accessToken;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/chat/ws`, [token]);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const broadcastId = 'test-broadcast-id-1';
    ws.send(JSON.stringify({ receiver_id: s1.id, content: 'hi everyone', broadcast_id: broadcastId, broadcast_scope: 'student' }));
    ws.send(JSON.stringify({ receiver_id: s2.id, content: 'hi everyone', broadcast_id: broadcastId, broadcast_scope: 'student' }));

    await new Promise((resolve) => setTimeout(resolve, 300));
    ws.close();

    const res = await request(app)
      .get('/api/v1/chat/broadcast-history/student')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.messages).toHaveLength(1);
    expect(res.body.data.messages[0].content).toBe('hi everyone');
    expect(res.body.data.messages[0].sender_id).toBe(admin.id);

    // Individual recipient copies are still fully real, durable 1:1 messages.
    const historyS1 = await request(app).get(`/api/v1/chat/history/${admin.id}`).set('Authorization', `Bearer ${(await request(app).post('/api/v1/auth/login').send({ email: 'bcast-s1@example.com', password: 'Sup3rSecret!' }).expect(200)).body.data.accessToken}`).expect(200);
    expect(historyS1.body.data.messages).toHaveLength(1);
    expect(historyS1.body.data.messages[0].content).toBe('hi everyone');
  });
});
