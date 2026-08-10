const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression test for the P1 finding in PROJECT_AUDIT_REPORT.md:
// batch_students.student_id used to store users._id instead of the
// students collection's own row id — breaking the join convention every
// sibling collection (test_assignments, results, achievements,
// placement_applications, resume_builder) follows. Fixed in
// batch.service.js#create by resolving the students row via
// studentRepository.findByUserId() before writing batch_students.
describe('Batches: batch_students.student_id matches the students collection convention', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let studentRepository;
  let batchStudentRepository;
  let hashPassword;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, hashPassword } = await buildTestApp());
    studentRepository = require('../../repositories/student.repository');
    batchStudentRepository = require('../../repositories/batchStudent.repository');
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function login(email, password) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.data.accessToken;
  }

  it('stores the students-collection row id, not the users-collection id, for a newly-created roster entry', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `BS-${Date.now()}` });
    const { user: admin, password } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `batch-admin-${Date.now()}@example.com`,
    });
    const token = await login(admin.email, password);

    const rollNumber = `R-${Date.now()}`;
    const res = await request(app)
      .post('/api/v1/batches')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Batch',
        department: 'CSE',
        year: 2026,
        students: [{ name: 'New Student', roll: rollNumber, department: 'CSE', year: 2 }],
      })
      .expect(201);

    const batchId = res.body.data.id;
    const createdUserId = res.body.data.createdStudents[0].id;

    // The user this batch import created.
    const user = await userRepository.findById(createdUserId);
    expect(user).toBeTruthy();
    // Its paired students-collection row — a different id from the user's own.
    const studentRow = await studentRepository.findByUserId(createdUserId);
    expect(studentRow).toBeTruthy();
    expect(studentRow.id).not.toBe(user.id);

    // The join row must reference the STUDENT row's id, not the user's.
    const { rows: joinRows } = await batchStudentRepository.findAll({
      page: 1,
      limit: 10,
      filters: { batch_id: batchId },
    });
    expect(joinRows).toHaveLength(1);
    expect(joinRows[0].student_id).toBe(studentRow.id);
    expect(joinRows[0].student_id).not.toBe(user.id);
  });

  it('resolves to the same existing students row id when the email already has an account', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `BS2-${Date.now()}` });
    const { user: existingStudentUser, password: studentPassword } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `existing-${Date.now()}@example.com`,
    });
    void studentPassword;
    const existingStudentRow = await studentRepository.create({
      user_id: existingStudentUser.id,
      institution_id: institution.id,
      roll_number: `EX-${Date.now()}`,
    });

    const { user: admin, password: adminPassword } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `batch-admin2-${Date.now()}@example.com`,
    });
    const token = await login(admin.email, adminPassword);

    const res = await request(app)
      .post('/api/v1/batches')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Batch 2',
        students: [{ name: existingStudentUser.full_name, email: existingStudentUser.email, roll: existingStudentRow.roll_number }],
      })
      .expect(201);

    const { rows: joinRows } = await batchStudentRepository.findAll({
      page: 1,
      limit: 10,
      filters: { batch_id: res.body.data.id },
    });
    expect(joinRows).toHaveLength(1);
    expect(joinRows[0].student_id).toBe(existingStudentRow.id);
  });
});
