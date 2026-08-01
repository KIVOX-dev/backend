const request = require('supertest');
const jwt = require('jsonwebtoken');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');

describe('Auth: register / login / refresh / change-password', () => {
  let app;
  let database;

  beforeAll(async () => {
    ({ app, database } = await buildTestApp());
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  let emailCounter = 0;
  function uniqueEmail(prefix) {
    emailCounter += 1;
    return `${prefix}-${emailCounter}@example.com`;
  }

  // Fresh account per call (rather than one shared account across every
  // `it()`) — this suite shares one in-memory DB for the whole file, so a
  // reused email would 409 on the second call.
  async function registerAndLogin(prefix = 'refresh-user') {
    const email = uniqueEmail(prefix);
    const password = 'Sup3rSecret!';
    await request(app).post('/api/v1/auth/register').send({ email, password, name: 'Refresh User' }).expect(201);
    const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.data;
  }

  it('registers a new student and immediately issues tokens', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'newbie@example.com', password: 'Sup3rSecret!', name: 'New Bie' })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it('logs in with valid credentials and returns both token casings', async () => {
    const data = await registerAndLogin();
    expect(data.accessToken).toBeTruthy();
    expect(data.access_token).toBe(data.accessToken); // legacy-field compat, see auth.controller.js
    expect(data.user.email).toBeTruthy();
  });

  it('rejects login with the wrong password', async () => {
    const email = uniqueEmail('wrong-pw');
    await request(app).post('/api/v1/auth/register').send({ email, password: 'Sup3rSecret!', name: 'Wrong Pw' }).expect(201);
    await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-password' }).expect(401);
  });

  // Regression test for C-1: the live frontend's bare-axios refresh call
  // sends `refresh_token` (snake_case) and reads access_token/refresh_token
  // off the top level of the response body — see api.ts. Both used to be
  // silently broken (Joi stripped the unrecognized field; the token fields
  // were nested a level too deep).
  it('refreshes with a snake_case refresh_token body and flat top-level token fields', async () => {
    const { refreshToken } = await registerAndLogin();

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(200);

    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    // Envelope form still present for every other consumer.
    expect(res.body.data.accessToken).toBe(res.body.access_token);
  });

  it('also accepts the camelCase refreshToken body', async () => {
    const { refreshToken } = await registerAndLogin();
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(200);
    expect(res.body.access_token).toBeTruthy();
  });

  it('supports refreshing repeatedly without forcing a re-login', async () => {
    const { refreshToken: first } = await registerAndLogin();
    const res1 = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: first }).expect(200);
    const second = res1.body.refresh_token;
    const res2 = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: second }).expect(200);
    expect(res2.body.access_token).toBeTruthy();
  });

  it('rejects a malformed/invalid refresh token', async () => {
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: 'not-a-real-token' })
      .expect(401);
  });

  it('rejects an expired refresh token', async () => {
    const expired = jwt.sign({ sub: 'someone', tv: 0 }, process.env.JWT_REFRESH_SECRET, { expiresIn: -10 });
    await request(app).post('/api/v1/auth/refresh').send({ refresh_token: expired }).expect(401);
  });

  it('rejects a refresh request with neither field present', async () => {
    await request(app).post('/api/v1/auth/refresh').send({}).expect(400);
  });

  // Regression test for C-3.
  it('changes password, rejects the wrong current password, and invalidates the old refresh token', async () => {
    const email = uniqueEmail('changer');
    await request(app).post('/api/v1/auth/register').send({ email, password: 'OldPass123!', name: 'Changer' }).expect(201);
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'OldPass123!' }).expect(200);
    const { accessToken, refreshToken } = login.body.data;

    await request(app)
      .put('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ current_password: 'wrong', new_password: 'NewPass123!' })
      .expect(400);

    const changeRes = await request(app)
      .put('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ current_password: 'OldPass123!', new_password: 'NewPass123!' })
      .expect(200);
    expect(changeRes.body.data.accessToken).toBeTruthy();

    // Old refresh token was issued before the password change and must now
    // be rejected (token_version bump) — see auth.service.js#changePassword.
    await request(app).post('/api/v1/auth/refresh').send({ refresh_token: refreshToken }).expect(401);

    // New credentials work.
    await request(app).post('/api/v1/auth/login').send({ email, password: 'NewPass123!' }).expect(200);
  });

  it('rejects change-password to the same password', async () => {
    const email = uniqueEmail('samepass');
    await request(app).post('/api/v1/auth/register').send({ email, password: 'Password123!', name: 'Same Pass' }).expect(201);
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123!' }).expect(200);

    await request(app)
      .put('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ current_password: 'Password123!', new_password: 'Password123!' })
      .expect(400);
  });

  it('rejects change-password without authentication', async () => {
    await request(app)
      .put('/api/v1/auth/change-password')
      .send({ current_password: 'a', new_password: 'Password123!' })
      .expect(401);
  });
});
