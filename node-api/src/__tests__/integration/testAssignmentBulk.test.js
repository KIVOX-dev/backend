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
  let questionRepository;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, studentRepository, hashPassword } = await buildTestApp());
    departmentRepository = require('../../repositories/department.repository');
    testRepository = require('../../repositories/test.repository');
    testAssignmentRepository = require('../../repositories/testAssignment.repository');
    questionRepository = require('../../repositories/question.repository');

    // Assignment now refuses a test whose source category has no questions,
    // so the 'quantitative' bank the tests below draw from needs some rows.
    if (!(await questionRepository.findOne({ category: 'quantitative' }))) {
      for (let i = 0; i < 5; i++) {
        await questionRepository.create({
          category: 'quantitative',
          question: `Seed question ${i}`,
          options: ['1', '2', '3', '4'],
          answer: '1',
        });
      }
    }
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

  async function seedClass(label, batchYear) {
    const institution = await seedInstitution(institutionRepository, { code: `${label}-${Date.now()}` });
    const department = await departmentRepository.create({ institution_id: institution.id, name: label, code: label });
    const { user: admin, password } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `${label}-admin-${Date.now()}@example.com`,
    });
    const adminToken = await login(admin.email, password);

    const makeStudent = async (suffix, year) => {
      const { user, password: pw } = await seedUser(userRepository, hashPassword, {
        role: 'student',
        institutionId: institution.id,
        email: `${label}-${suffix}-${Date.now()}@example.com`,
      });
      await studentRepository.create({
        user_id: user.id,
        institution_id: institution.id,
        department_id: department.id,
        batch_year: year,
        roll_number: `${label}-${suffix}`,
      });
      return login(user.email, pw);
    };
    return { institution, department, adminToken, makeStudent, batchYear };
  }

  it('rejects assignment when the source question bank is empty and saves nothing', async () => {
    const { institution, department, adminToken, makeStudent } = await seedClass('EMP', 2030);
    await makeStudent('s1', 2030);
    const test = await testRepository.create({
      institution_id: institution.id,
      title: 'Empty Bank Test',
      source_category: `no_such_category_${Date.now()}`,
      question_count: 5,
    });

    const res = await request(app)
      .post('/api/v1/test-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ test_id: test.id, department_id: department.id, batch_year: 2030 })
      .expect(400);
    expect(res.body.message || res.body.error?.message).toMatch(/question bank is empty/i);

    const { rows } = await testAssignmentRepository.findAll({ page: 1, limit: 10, filters: { test_id: test.id } });
    expect(rows).toHaveLength(0);
  });

  it('shows an assigned, published test (with questions) only to assigned students', async () => {
    const { institution, department, adminToken, makeStudent } = await seedClass('VIS', 2031);
    const assignedToken = await makeStudent('in', 2031);
    const otherBatchToken = await makeStudent('out', 2032);
    const test = await testRepository.create({
      institution_id: institution.id,
      title: 'Visible Test',
      source_category: 'quantitative',
      question_count: 3,
      status: 'active',
    });

    await request(app)
      .post('/api/v1/test-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ test_id: test.id, department_id: department.id, batch_year: 2031 })
      .expect(201);

    const mine = await request(app).get('/api/v1/tests').set('Authorization', `Bearer ${assignedToken}`).expect(200);
    const row = (mine.body.data.rows || mine.body.data).find((t) => t.id === test.id);
    expect(row).toBeTruthy();
    expect(row.assignment_id).toBeTruthy();

    const qs = await request(app)
      .get(`/api/v1/test-assignments/${row.assignment_id}/questions`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .expect(200);
    expect((qs.body.data.rows || qs.body.data).length).toBeGreaterThan(0);

    const theirs = await request(app).get('/api/v1/tests').set('Authorization', `Bearer ${otherBatchToken}`).expect(200);
    expect((theirs.body.data.rows || theirs.body.data).some((t) => t.id === test.id)).toBe(false);
  });

  it('hides an assigned draft test from the student until it is published', async () => {
    const { institution, department, adminToken, makeStudent } = await seedClass('DRF', 2033);
    const studentToken = await makeStudent('s', 2033);
    const test = await testRepository.create({
      institution_id: institution.id,
      title: 'Draft Test',
      source_category: 'quantitative',
      question_count: 3,
      status: 'draft',
    });
    await request(app)
      .post('/api/v1/test-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ test_id: test.id, department_id: department.id, batch_year: 2033 })
      .expect(201);

    const before = await request(app).get('/api/v1/tests').set('Authorization', `Bearer ${studentToken}`).expect(200);
    expect((before.body.data.rows || before.body.data).some((t) => t.id === test.id)).toBe(false);

    await testRepository.updateById(test.id, { status: 'active' });
    const after = await request(app).get('/api/v1/tests').set('Authorization', `Bearer ${studentToken}`).expect(200);
    expect((after.body.data.rows || after.body.data).some((t) => t.id === test.id)).toBe(true);
  });
});
