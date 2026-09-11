const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// POST /test-assignments (bulk department+batch_year path) used to loop
// over every matching student fully sequentially — each row is 2-3 real DB
// round trips (an existence check, a $sample draw, a write) — so assigning
// to a real department-sized roster (100+ students) routinely exceeded the
// frontend's request timeout, same failure mode student.service.js#batchCreate
// had. Fixed by processing students in concurrent chunks of 10 instead of
// one at a time (see testAssignment.service.js#create). These tests pin the
// *correctness* of that change — same assigned-count, no duplicate
// assignments, already-assigned students correctly skipped — since the
// whole point was to make it faster without making it wrong.
describe('POST /test-assignments (bulk department+batch_year)', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let studentRepository;
  let hashPassword;
  let departmentRepository;
  let testRepository;
  let testAssignmentRepository;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, studentRepository, hashPassword } = await buildTestApp());
    departmentRepository = require('../../repositories/department.repository');
    testRepository = require('../../repositories/test.repository');
    testAssignmentRepository = require('../../repositories/testAssignment.repository');
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function login(email, password) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.data.accessToken;
  }

  it('assigns every matching student in a larger roster, processed in concurrent chunks', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `TA-${Date.now()}` });
    const department = await departmentRepository.create({ institution_id: institution.id, name: 'CSE', code: 'CSE' });
    const batchYear = 2028;

    const { user: admin, password } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `ta-admin-${Date.now()}@example.com`,
    });
    const token = await login(admin.email, password);

    // Bigger than the 10-row chunk size, so this actually exercises more
    // than one chunk boundary.
    const studentCount = 25;
    for (let i = 0; i < studentCount; i++) {
      const { user } = await seedUser(userRepository, hashPassword, {
        role: 'student',
        institutionId: institution.id,
        email: `ta-student-${Date.now()}-${i}@example.com`,
      });
      await studentRepository.create({
        user_id: user.id,
        institution_id: institution.id,
        department_id: department.id,
        batch_year: batchYear,
        roll_number: `TA-${i}`,
      });
    }

    const test = await testRepository.create({
      institution_id: institution.id,
      title: 'Bulk Assign Test',
      source_category: 'quantitative',
      question_count: 5,
    });

    const res = await request(app)
      .post('/api/v1/test-assignments')
      .set('Authorization', `Bearer ${token}`)
      .send({ test_id: test.id, department_id: department.id, batch_year: batchYear })
      .expect(201);

    expect(res.body.data.assigned_count).toBe(studentCount);
    expect(res.body.data.matched_students).toBe(studentCount);

    const { rows: assignments } = await testAssignmentRepository.findAll({
      page: 1,
      limit: 100,
      filters: { test_id: test.id },
    });
    expect(assignments).toHaveLength(studentCount);
    // Every matched student got exactly one assignment row — no duplicates
    // from a chunk-boundary race.
    const uniqueStudentIds = new Set(assignments.map((a) => a.student_id));
    expect(uniqueStudentIds.size).toBe(studentCount);
  });

  it('skips students already assigned to the same test instead of duplicating', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `TA2-${Date.now()}` });
    const department = await departmentRepository.create({ institution_id: institution.id, name: 'ECE', code: 'ECE' });
    const batchYear = 2029;

    const { user: admin, password } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `ta2-admin-${Date.now()}@example.com`,
    });
    const token = await login(admin.email, password);

    const { user: studentUser } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `ta2-student-${Date.now()}@example.com`,
    });
    await studentRepository.create({
      user_id: studentUser.id,
      institution_id: institution.id,
      department_id: department.id,
      batch_year: batchYear,
      roll_number: 'TA2-1',
    });

    const test = await testRepository.create({
      institution_id: institution.id,
      title: 'Re-assign Test',
      source_category: 'quantitative',
      question_count: 5,
    });

    // First assignment.
    await request(app)
      .post('/api/v1/test-assignments')
      .set('Authorization', `Bearer ${token}`)
      .send({ test_id: test.id, department_id: department.id, batch_year: batchYear })
      .expect(201);

    // Second call for the same department/batch_year — the one student
    // already has an assignment row, so this must be a no-op, not a
    // duplicate or a unique-index error.
    const res = await request(app)
      .post('/api/v1/test-assignments')
      .set('Authorization', `Bearer ${token}`)
      .send({ test_id: test.id, department_id: department.id, batch_year: batchYear })
      .expect(201);

    expect(res.body.data.assigned_count).toBe(0);
    expect(res.body.data.matched_students).toBe(1);

    const { rows: assignments } = await testAssignmentRepository.findAll({
      page: 1,
      limit: 100,
      filters: { test_id: test.id },
    });
    expect(assignments).toHaveLength(1);
  });
});
