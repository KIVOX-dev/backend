const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// YOUTUBE_API_KEY is never set in this Jest suite (no .env.node value, and
// this test doesn't set one), so /courses/import always hits the real
// "not configured" path — same reasoning as aiFeatures.test.js for the AI
// service being unreachable. Also covers role-gating (student-only, like
// /students/profile) and the "no student profile yet" guard.
describe('Courses (YouTube to Course)', () => {
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

  async function seedStudent(institutionId, overrides = {}) {
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId,
      email: `course-student-${Date.now()}-${Math.random()}@example.com`,
    });
    await studentRepository.create({
      user_id: user.id,
      institution_id: institutionId,
      phone: '555-0100',
      date_of_birth: '2000-01-01',
      gender: 'female',
      address: '123 Test St',
      cgpa: 8.5,
      ...overrides,
    });
    return { user, password };
  }

  it('POST /courses/import returns 503 when YOUTUBE_API_KEY is not configured', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `CRS-${Date.now()}` });
    const { user, password } = await seedStudent(institution.id);
    const token = await login(user.email, password);

    const res = await request(app)
      .post('/api/v1/courses/import')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
      .expect(503);
    expect(res.body.message).toMatch(/not configured/i);
  });

  it('GET /courses is student-only (institution_admin gets 403)', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `CRA-${Date.now()}` });
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `course-admin-${Date.now()}@example.com`,
    });
    const token = await login(user.email, password);

    await request(app).get('/api/v1/courses').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('GET /courses requires authentication', async () => {
    await request(app).get('/api/v1/courses').expect(401);
  });

  it('GET /courses returns an empty list for a student with no imported courses yet', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `CRL-${Date.now()}` });
    const { user, password } = await seedStudent(institution.id);
    const token = await login(user.email, password);

    const res = await request(app).get('/api/v1/courses').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('GET /courses/:id 404s for a course that does not exist (or is not this student\'s)', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `CRN-${Date.now()}` });
    const { user, password } = await seedStudent(institution.id);
    const token = await login(user.email, password);

    await request(app)
      .get('/api/v1/courses/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
