const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression tests for the P0 finding in PROJECT_AUDIT_REPORT.md: GET
// /api/v1/dashboard/student/:studentId had no ownership check at all — any
// authenticated user, any role, any institution, could read any other
// student's dashboard stats just by knowing their id. Fixed by gating
// dashboard.service.js#studentDashboard with the same canActOnStudent() check
// every other per-student endpoint in student.service.js already uses.
describe('Dashboard: student dashboard is ownership-gated', () => {
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
      ...overrides,
    });
    const student = await studentRepository.create({
      user_id: user.id,
      institution_id: institutionId,
      tests_completed: 3,
    });
    return { user, password, student };
  }

  it('blocks a student in another institution from reading a student dashboard by id', async () => {
    const institutionA = await seedInstitution(institutionRepository, { code: `DA-${Date.now()}` });
    const institutionB = await seedInstitution(institutionRepository, { code: `DB-${Date.now()}` });
    const { student: targetStudent } = await seedStudent(institutionA.id);
    const { user: outsider, password } = await seedStudent(institutionB.id).then((r) => r);

    const token = await login(outsider.email, password);
    await request(app)
      .get(`/api/v1/dashboard/student/${targetStudent.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('blocks any arbitrary authenticated non-staff caller regardless of role guesswork', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `DC-${Date.now()}` });
    const other = await seedInstitution(institutionRepository, { code: `DD-${Date.now()}` });
    const { student: targetStudent } = await seedStudent(institution.id);
    const { user: hrUser, password } = await seedUser(userRepository, hashPassword, {
      role: 'hr',
      email: `hr-${Date.now()}@example.com`,
    });
    void other;

    const token = await login(hrUser.email, password);
    await request(app)
      .get(`/api/v1/dashboard/student/${targetStudent.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('allows the student themself to read their own dashboard', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `DE-${Date.now()}` });
    const { user, password, student } = await seedStudent(institution.id);

    const token = await login(user.email, password);
    const res = await request(app)
      .get(`/api/v1/dashboard/student/${student.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.data).toHaveProperty('tests_completed');
  });

  it('allows an institution_admin in the same institution to read the dashboard', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `DF-${Date.now()}` });
    const { student } = await seedStudent(institution.id);
    const { user: admin, password } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `admin-${Date.now()}@example.com`,
    });

    const token = await login(admin.email, password);
    await request(app)
      .get(`/api/v1/dashboard/student/${student.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('allows a super_admin to read any student dashboard', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `DG-${Date.now()}` });
    const { student } = await seedStudent(institution.id);
    const { user: superAdmin, password } = await seedUser(userRepository, hashPassword, {
      role: 'super_admin',
      email: `super-${Date.now()}@example.com`,
    });

    const token = await login(superAdmin.email, password);
    await request(app)
      .get(`/api/v1/dashboard/student/${student.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
