const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression coverage for the Phase 3 AI-service migration: interview
// question generation, resume AI features, and assessment question
// generation now proxy to the FastAPI ai-service (see
// utils/aiServiceClient.js) instead of calling Groq directly from node-api.
// The ai-service is never running during this Jest suite, so every call
// here genuinely fails to connect — this exercises the real
// AiServiceUnavailableError fallback path, not a mocked one.
describe('AI features: graceful degradation when the AI service is unreachable', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let studentRepository;
  let hashPassword;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, studentRepository, hashPassword } = await buildTestApp());
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function login(email, password) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.data.accessToken;
  }

  async function loginAsAdmin(institutionId) {
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId,
      email: `ai-admin-${Date.now()}-${Math.random()}@example.com`,
    });
    return login(user.email, password);
  }

  it('POST /interviews/generate falls back to local questions instead of failing', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `AII-${Date.now()}` });
    const token = await loginAsAdmin(institution.id);

    const res = await request(app)
      .post('/api/v1/interviews/generate?role=Backend%20Engineer&company=Acme')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data).toHaveLength(10);
    expect(res.body.data.every((q) => q.type === 'technical')).toBe(true);
    expect(res.body.data.every((q) => q.text.includes('ACME') && q.text.includes('BACKEND ENGINEER'))).toBe(true);
  });

  it('POST /tests/generate-questions falls back to a local placeholder question instead of failing', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `AIT-${Date.now()}` });
    const token = await loginAsAdmin(institution.id);

    const res = await request(app)
      .post('/api/v1/tests/generate-questions')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Data Structures', type: 'quiz', difficulty: 'hard' })
      .expect(200);

    expect(res.body.data.questions).toHaveLength(1);
    expect(res.body.data.questions[0].question).toContain('Data Structures');
  });

  it('resume AI endpoints surface a 503 (not a crash) when the AI service is unreachable', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `AIR-${Date.now()}` });
    const { user: student, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `ai-student-${Date.now()}@example.com`,
    });
    await studentRepository.create({
      user_id: student.id,
      institution_id: institution.id,
      phone: '555-0100',
      date_of_birth: '2000-01-01',
      gender: 'female',
      address: '123 Test St',
      cgpa: 8.5,
    });
    const token = await login(student.email, password);

    await request(app).get('/api/v1/resume').set('Authorization', `Bearer ${token}`).expect(200);

    const res = await request(app).post('/api/v1/resume/analyze').set('Authorization', `Bearer ${token}`).expect(503);
    expect(res.body.message).toMatch(/unavailable/i);
  });
});
