const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');

describe('GET /chat/threads (throwaway verification)', () => {
  let app, database, userRepository, hashPassword;

  beforeAll(async () => {
    ({ app, database } = await buildTestApp());
    userRepository = require('../../repositories/user.repository');
    ({ hashPassword } = require('../../utils/password'));
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  it('returns the other party after a broadcast-style message exchange', async () => {
    const messageRepository = require('../../repositories/message.repository');
    const pw = await hashPassword('Sup3rSecret!');
    const admin = await userRepository.create({ email: 'admin-threads@example.com', password_hash: pw, full_name: 'Admin', role: 'institution_admin' });
    const student = await userRepository.create({ email: 'student-threads@example.com', password_hash: pw, full_name: 'Student One', role: 'student' });

    await messageRepository.create({ sender_id: admin.id, sender_name: admin.full_name, sender_role: admin.role, receiver_id: student.id, content: 'hi' });

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'student-threads@example.com', password: 'Sup3rSecret!' }).expect(200);
    const token = login.body.data.accessToken;

    const res = await request(app).get('/api/v1/chat/threads').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.data.partners).toHaveLength(1);
    expect(res.body.data.partners[0].id).toBe(admin.id);
    expect(res.body.data.partners[0].full_name).toBe('Admin');
  });
});
