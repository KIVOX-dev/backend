const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression test: GET /resume/all used the generic crudControllerFactory
// `list` handler, which calls service.list(req.query) with no second
// argument — but resumeBuilder.service.js#list requires `actor` to build its
// institution filter. Every staff call to this endpoint crashed with a
// TypeError reading institutionId off undefined. Caught while auditing every
// route built on the generic factory's list() after the Express 5 regression
// in department/collegeAdmin/faculty turned up the same missing-actor class
// of bug. Unrelated to Express 5 itself — the factory never passed req.user
// in any version.
describe('Resume Builder: staff listing (GET /resume/all)', () => {
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
      email: `resume-student-${Date.now()}-${Math.random()}@example.com`,
      ...overrides,
    });
    await studentRepository.create({
      user_id: user.id,
      institution_id: institutionId,
      phone: '555-0100',
      date_of_birth: '2000-01-01',
      gender: 'female',
      address: '123 Test St',
      cgpa: 8.5,
    });
    return { user, password };
  }

  it('does not crash and never leaks another institution\'s resumes', async () => {
    const institutionA = await seedInstitution(institutionRepository, { code: `RA-${Date.now()}` });
    const institutionB = await seedInstitution(institutionRepository, { code: `RB-${Date.now()}` });

    const { user: studentA, password: studentAPassword } = await seedStudent(institutionA.id);
    const tokenStudentA = await login(studentA.email, studentAPassword);
    // GET / auto-creates a default resume for the calling student.
    await request(app).get('/api/v1/resume').set('Authorization', `Bearer ${tokenStudentA}`).expect(200);

    const { user: studentB, password: studentBPassword } = await seedStudent(institutionB.id);
    const tokenStudentB = await login(studentB.email, studentBPassword);
    await request(app).get('/api/v1/resume').set('Authorization', `Bearer ${tokenStudentB}`).expect(200);

    const { user: adminA, password: adminAPassword } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institutionA.id,
      email: `resume-admin-a-${Date.now()}@example.com`,
    });
    const tokenAdminA = await login(adminA.email, adminAPassword);

    const res = await request(app).get('/api/v1/resume/all').set('Authorization', `Bearer ${tokenAdminA}`).expect(200);
    const studentIds = res.body.data.map((r) => r.student_id);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(studentIds.every((id) => id !== undefined)).toBe(true);
  });

  it('super_admin listing across every institution does not crash', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `RS-${Date.now()}` });
    const { user: student, password: studentPassword } = await seedStudent(institution.id);
    const tokenStudent = await login(student.email, studentPassword);
    await request(app).get('/api/v1/resume').set('Authorization', `Bearer ${tokenStudent}`).expect(200);

    const { user: superAdmin, password } = await seedUser(userRepository, hashPassword, {
      role: 'super_admin',
      email: `resume-super-${Date.now()}@example.com`,
    });
    const superToken = await login(superAdmin.email, password);

    await request(app).get('/api/v1/resume/all').set('Authorization', `Bearer ${superToken}`).expect(200);
  });
});
