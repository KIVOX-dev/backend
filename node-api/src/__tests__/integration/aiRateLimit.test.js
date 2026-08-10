const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression tests for the P1 finding in PROJECT_AUDIT_REPORT.md: AI/Groq-
// proxying endpoints (resume analyze/match-jd/ai-suggest/parse/improve,
// interview generation, assessment question generation) used to share only
// the generic apiLimiter, with no per-user ceiling on a metered, paid
// upstream. middlewares/rateLimiter.js#aiLimiter/aiInstitutionLimiter close
// that. This suite sets its own tight AI_RATE_LIMIT_MAX (overriding
// testApp.js's default 1000) specifically to exercise the 429 path.
describe('AI endpoints: dedicated rate limiting', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let hashPassword;

  beforeAll(async () => {
    process.env.AI_RATE_LIMIT_MAX = '3';
    ({ app, database, institutionRepository, userRepository, hashPassword } = await buildTestApp());
  });

  afterAll(async () => {
    delete process.env.AI_RATE_LIMIT_MAX;
    await teardownTestApp(database);
  });

  async function loginAsAdmin() {
    const institution = await seedInstitution(institutionRepository, { code: `AIRL-${Date.now()}` });
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `ai-ratelimit-${Date.now()}-${Math.random()}@example.com`,
    });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    return res.body.data.accessToken;
  }

  it('returns 429 after AI_RATE_LIMIT_MAX requests to an AI-proxying endpoint within the window', async () => {
    const token = await loginAsAdmin();

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app)
        .post('/api/v1/tests/generate-questions')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Data Structures', type: 'quiz', difficulty: 'hard' });
      expect(res.status).toBe(200);
    }

    const res = await request(app)
      .post('/api/v1/tests/generate-questions')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Data Structures', type: 'quiz', difficulty: 'hard' });
    expect(res.status).toBe(429);
  });

  it('shares one quota across different AI routes for the same user, not one quota per route', async () => {
    const token = await loginAsAdmin();

    await request(app)
      .post('/api/v1/interviews/generate?role=Backend%20Engineer&company=Acme')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app)
      .post('/api/v1/tests/generate-questions')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Algorithms', type: 'quiz', difficulty: 'easy' })
      .expect(200);
    await request(app)
      .post('/api/v1/interviews/generate?role=Backend%20Engineer&company=Acme')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // 4th AI-proxying call for this user across any of the covered routes —
    // quota is per user, not per route, so this trips even on a route it
    // hasn't hit before.
    const res = await request(app)
      .post('/api/v1/tests/generate-questions')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Algorithms', type: 'quiz', difficulty: 'easy' });
    expect(res.status).toBe(429);
  });

  it('does not rate-limit a different user sharing the same AI quota window', async () => {
    const tokenA = await loginAsAdmin();
    const tokenB = await loginAsAdmin();

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post('/api/v1/tests/generate-questions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ title: 'Data Structures', type: 'quiz', difficulty: 'hard' })
        .expect(200);
    }

    // User A is now exhausted; user B has made zero AI requests and should
    // still be allowed through.
    await request(app)
      .post('/api/v1/tests/generate-questions')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'Data Structures', type: 'quiz', difficulty: 'hard' })
      .expect(200);
  });
});
