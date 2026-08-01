const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression tests for H-6: GET /students has no role gate (PlatformChat.tsx
// calls it as a student when GET /users/ 403s them), and used to return every
// raw student field — phone, date_of_birth, gender, address, cgpa — to
// whichever role asked. Non-staff callers should get a minimal directory
// projection instead; staff should still see full records within their own
// institution and never another institution's.
describe('Students: PII-minimized directory for non-staff, full detail for staff', () => {
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
      email: `student-${Date.now()}-${Math.random()}@example.com`,
      phone: '555-0100',
      ...overrides,
    });
    await studentRepository.create({
      user_id: user.id,
      institution_id: institutionId,
      phone: '555-0100',
      date_of_birth: '2000-01-01',
      gender: 'female',
      address: '123 Secret St',
      cgpa: 8.9,
    });
    return { user, password };
  }

  it('hides sensitive fields from a student caller but keeps id/name/email', async () => {
    const institution = await seedInstitution(institutionRepository);
    const { user: viewer, password } = await seedStudent(institution.id);
    await seedStudent(institution.id); // a classmate, visible in the directory

    const token = await login(viewer.email, password);
    const res = await request(app).get('/api/v1/students').set('Authorization', `Bearer ${token}`).expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const entry of res.body.data) {
      expect(entry).not.toHaveProperty('phone');
      expect(entry).not.toHaveProperty('date_of_birth');
      expect(entry).not.toHaveProperty('gender');
      expect(entry).not.toHaveProperty('address');
      expect(entry).not.toHaveProperty('cgpa');
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('full_name');
    }
  });

  it('gives staff (institution_admin) the full record within their own institution', async () => {
    const institution = await seedInstitution(institutionRepository);
    await seedStudent(institution.id);
    const { user: admin, password: adminPassword } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `admin-${Date.now()}@example.com`,
    });
    const token = await login(admin.email, adminPassword);

    const res = await request(app)
      .get('/api/v1/students')
      .query({ search: 'student' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toHaveProperty('date_of_birth');
  });

  it('never leaks a student from a different institution into another institution_admin\'s search', async () => {
    const institutionA = await seedInstitution(institutionRepository, { code: `SA-${Date.now()}` });
    const institutionB = await seedInstitution(institutionRepository, { code: `SB-${Date.now()}` });
    await seedStudent(institutionB.id, { full_name: 'Cross Tenant Student' });
    const { user: adminA, password: adminPassword } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institutionA.id,
      email: `admin-a-${Date.now()}@example.com`,
    });
    const token = await login(adminA.email, adminPassword);

    const res = await request(app)
      .get('/api/v1/students')
      .query({ search: 'Cross Tenant' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.length).toBe(0);
  });
});
