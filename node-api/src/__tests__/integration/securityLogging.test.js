const { Writable } = require('stream');
const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// CERT-In / ASVS logging: security events are emitted as structured lines
// (logType="security") with actor, IP and request id, and nothing emitted
// during these flows ever contains a password, token, or raw email.
describe('Security event logging', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let hashPassword;
  let lines;
  let institution;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, hashPassword } = await buildTestApp());
    // Same module registry as the app (buildTestApp resets it).
    const winston = require('winston');
    const logger = require('../../utils/logger');
    lines = [];
    logger.add(new winston.transports.Stream({
      stream: new Writable({
        write(chunk, _encoding, callback) {
          lines.push(chunk.toString());
          callback();
        },
      }),
    }));
    institution = await seedInstitution(institutionRepository);
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  beforeEach(() => {
    lines.length = 0;
  });

  const events = (name) => lines.map((l) => JSON.parse(l)).filter((l) => l.logType === 'security' && l.event === name);

  // Winston writes asynchronously through the stream; 'finish'-hooked events
  // (admin.action) fire just after the response. Give both a tick to land.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  let counter = 0;
  async function seed(role, extra = {}) {
    counter += 1;
    return seedUser(userRepository, hashPassword, {
      role,
      institutionId: role === 'super_admin' ? null : institution.id,
      email: `seclog-${counter}-${Date.now()}@example.com`,
      ...extra,
    });
  }

  async function login(user, password) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('ts_refresh='));
    return { ...res.body.data, refreshToken: cookie && cookie.split(';')[0].slice('ts_refresh='.length) };
  }

  it('logs a failed login with a reason, IP and pseudonymous email — never the password or email', async () => {
    const { user } = await seed('student');
    await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong-Passw0rd!' }).expect(401);
    await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'Wrong-Passw0rd!' }).expect(401);
    await settle();

    const [badPassword, unknownUser] = events('auth.login_failed');
    expect(badPassword).toMatchObject({ reason: 'bad_password', targetUserId: user.id, alert: 'failed_login', severity: 'WARNING' });
    expect(badPassword.ip).toBeTruthy();
    expect(badPassword.requestId).toBeTruthy();
    expect(badPassword.emailHash).toMatch(/^[0-9a-f]{16}$/);
    expect(unknownUser).toMatchObject({ reason: 'unknown_user', targetUserId: null });

    const all = lines.join('\n');
    expect(all).not.toContain('Wrong-Passw0rd!');
    expect(all).not.toContain(user.email);
    expect(all).not.toContain('nobody@example.com');
  });

  it('logs a successful login without leaking the issued tokens', async () => {
    const { user, password } = await seed('student');
    const { accessToken, refreshToken } = await login(user, password);
    await settle();

    expect(events('auth.login_succeeded')).toEqual([
      expect.objectContaining({ actorId: user.id, actorRole: 'student', method: 'password' }),
    ]);
    const all = lines.join('\n');
    expect(all).not.toContain(accessToken);
    expect(refreshToken).toBeTruthy();
    expect(all).not.toContain(refreshToken);
  });

  it('raises a privilege_change alert event when a super admin changes a role', async () => {
    const { user: admin, password } = await seed('super_admin');
    const { user: target } = await seed('student');
    const { accessToken } = await login(admin, password);

    await request(app)
      .put(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'faculty' })
      .expect(200);
    await settle();

    expect(events('user.role_changed')).toEqual([
      expect.objectContaining({ actorId: admin.id, targetUserId: target.id, oldValue: 'student', newValue: 'faculty', alert: 'privilege_change' }),
    ]);
    expect(events('admin.action')).toEqual([
      expect.objectContaining({ method: 'PUT', route: '/api/v1/users/:id', targetIds: [target.id], outcome: 'success' }),
    ]);
  });

  it('does not log a role change when the role stays the same', async () => {
    const { user: admin, password } = await seed('super_admin');
    const { user: target } = await seed('student');
    const { accessToken } = await login(admin, password);

    await request(app)
      .put(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'student' })
      .expect(200);
    await settle();

    expect(events('user.role_changed')).toEqual([]);
  });

  it('logs deactivation and deletion of an account', async () => {
    const { user: admin, password } = await seed('institution_admin');
    const { user: target } = await seed('faculty');
    const { accessToken } = await login(admin, password);

    await request(app)
      .put(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ is_active: false })
      .expect(200);
    await request(app).delete(`/api/v1/users/${target.id}`).set('Authorization', `Bearer ${accessToken}`).expect(200);
    await settle();

    expect(events('user.status_changed')).toEqual([
      expect.objectContaining({ targetUserId: target.id, field: 'is_active', oldValue: true, newValue: false }),
    ]);
    expect(events('user.deleted')).toEqual([
      expect.objectContaining({ actorId: admin.id, targetUserId: target.id, role: 'faculty' }),
    ]);
  });

  it('logs access denied for a 403', async () => {
    const { user, password } = await seed('student');
    const { accessToken } = await login(user, password);
    const { user: other } = await seed('faculty');

    await request(app).delete(`/api/v1/users/${other.id}`).set('Authorization', `Bearer ${accessToken}`).expect(403);
    await settle();

    expect(events('access.denied')).toEqual([
      expect.objectContaining({ actorId: user.id, actorRole: 'student', method: 'DELETE', path: `/api/v1/users/${other.id}` }),
    ]);
  });

  it('does not record student requests as admin actions', async () => {
    const { user, password } = await seed('student');
    const { accessToken } = await login(user, password);

    await request(app)
      .put(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ preferences: { theme: 'dark' } })
      .expect(200);
    await settle();

    expect(events('admin.action')).toEqual([]);
  });
});
