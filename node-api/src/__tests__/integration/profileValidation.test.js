const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression tests for the P1 finding in PROJECT_AUDIT_REPORT.md:
// POST/PUT /profile accepted an arbitrary `values` object with no
// server-side schema check — every field, known or not, was persisted
// as-is. Fixed by validations/profile.validation.js, which whitelists
// against the caller's own onboarding portal schema.
describe('Profile: values are whitelisted against the onboarding schema', () => {
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

  async function loginAsHr() {
    const institution = await seedInstitution(institutionRepository);
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'hr',
      institutionId: institution.id,
      email: `profile-${Date.now()}-${Math.random()}@example.com`,
    });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    return res.body.data.accessToken;
  }

  it('strips a field that is not on the hr onboarding schema', async () => {
    const token = await loginAsHr();
    const res = await request(app)
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeId: 'EMP-001', isSuperAdmin: true, institution_id: 'some-other-institution' })
      .expect(200);

    expect(res.body.data.values.employeeId).toBe('EMP-001');
    expect(res.body.data.values).not.toHaveProperty('isSuperAdmin');
    expect(res.body.data.values).not.toHaveProperty('institution_id');
  });

  it('rejects a select field value outside its declared options', async () => {
    const token = await loginAsHr();
    await request(app)
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ department: 'not-a-real-department' })
      .expect(400);
  });

  it('rejects a number field outside its declared range', async () => {
    const token = await loginAsHr();
    await request(app)
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ yearsOfExperience: 999 })
      .expect(400);
  });

  it('accepts a valid partial submission of only known fields', async () => {
    const token = await loginAsHr();
    const res = await request(app)
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeId: 'EMP-002', department: 'payroll', yearsOfExperience: 4 })
      .expect(200);

    expect(res.body.data.values).toMatchObject({ employeeId: 'EMP-002', department: 'payroll', yearsOfExperience: 4 });
  });
});
