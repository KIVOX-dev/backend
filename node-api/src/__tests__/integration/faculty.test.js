const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression test: faculty listing used the raw BaseService.list() with no
// institution scoping at all — GET /faculty silently returned every
// institution's faculty rows to any authenticated caller. Surfaced by the
// Express 5 migration (see departments.test.js for the root cause), but
// this entity was never scoped via req.query to begin with — it just had
// no scoping whatsoever, in any Express version.
describe('Faculty: institution-scoped listing', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let hashPassword;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, hashPassword } = await buildTestApp());
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
      email: `fac-admin-${Date.now()}-${Math.random()}@example.com`,
    });
    return login(user.email, password);
  }

  it('never leaks another institution\'s faculty rows into the list', async () => {
    const institutionA = await seedInstitution(institutionRepository, { code: `FA-${Date.now()}` });
    const institutionB = await seedInstitution(institutionRepository, { code: `FB-${Date.now()}` });
    const tokenA = await loginAsAdmin(institutionA.id);
    const tokenB = await loginAsAdmin(institutionB.id);

    const { user: facultyUserA } = await seedUser(userRepository, hashPassword, {
      role: 'faculty',
      institutionId: institutionA.id,
      email: `fac-user-a-${Date.now()}@example.com`,
    });
    const { user: facultyUserB } = await seedUser(userRepository, hashPassword, {
      role: 'faculty',
      institutionId: institutionB.id,
      email: `fac-user-b-${Date.now()}@example.com`,
    });

    await request(app)
      .post('/api/v1/faculty')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ user_id: facultyUserA.id, institution_id: institutionA.id, designation: 'Professor A' })
      .expect(201);
    await request(app)
      .post('/api/v1/faculty')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ user_id: facultyUserB.id, institution_id: institutionB.id, designation: 'Professor B' })
      .expect(201);

    const listA = await request(app).get('/api/v1/faculty').set('Authorization', `Bearer ${tokenA}`).expect(200);
    const designations = listA.body.data.map((r) => r.designation);
    expect(designations).toContain('Professor A');
    expect(designations).not.toContain('Professor B');
  });

  it('super_admin sees faculty across every institution', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `FS-${Date.now()}` });
    const { user: superAdmin, password } = await seedUser(userRepository, hashPassword, {
      role: 'super_admin',
      email: `super-fac-${Date.now()}@example.com`,
    });
    const superToken = await login(superAdmin.email, password);

    const { user: facultyUser } = await seedUser(userRepository, hashPassword, {
      role: 'faculty',
      institutionId: institution.id,
      email: `fac-target-${Date.now()}@example.com`,
    });
    await request(app)
      .post('/api/v1/faculty')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ user_id: facultyUser.id, institution_id: institution.id, designation: 'Cross-visible Professor' })
      .expect(201);

    const res = await request(app).get('/api/v1/faculty').set('Authorization', `Bearer ${superToken}`).expect(200);
    expect(res.body.data.map((r) => r.designation)).toContain('Cross-visible Professor');
  });

  it('student cannot create a faculty profile', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `FST-${Date.now()}` });
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `fac-student-${Date.now()}@example.com`,
    });
    const token = await login(user.email, password);

    await request(app)
      .post('/api/v1/faculty')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: user.id, institution_id: institution.id, designation: 'Should Fail' })
      .expect(403);
  });
});
