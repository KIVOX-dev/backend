const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// POST /students/batch (FacultyUpload.tsx's target) used to process every
// roster row fully sequentially, awaiting a real network call to the email
// provider for each newly-created student before starting the next row —
// large uploads routinely exceeded the frontend's request timeout even
// though the server was still working. Fixed by no longer awaiting the
// welcome email and processing rows in small concurrent chunks instead of
// one at a time (see student.service.js#batchCreate and
// utils/studentOnboarding.js). These tests pin the *correctness* of that
// change — same created-count, same per-student data — since the whole
// point was to make it faster without making it wrong.
describe('POST /students/batch', () => {
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

  it('creates every row in a larger roster correctly when processed in concurrent chunks', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `BC-${Date.now()}` });
    const { user: faculty, password } = await seedUser(userRepository, hashPassword, {
      role: 'faculty',
      institutionId: institution.id,
      email: `faculty-${Date.now()}@example.com`,
    });
    const token = await login(faculty.email, password);

    // Bigger than the 10-row chunk size, so this actually exercises more
    // than one chunk boundary.
    const rowCount = 25;
    const students = Array.from({ length: rowCount }, (_, i) => ({
      name: `Student ${i}`,
      email: `batch-student-${Date.now()}-${i}@example.com`,
      roll: `BR-${Date.now()}-${i}`,
    }));

    const res = await request(app)
      .post('/api/v1/students/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ students })
      .expect(201);

    expect(res.body.data.created).toBe(rowCount);
    // Faculty-created students land as 'pending', not auto-approved.
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.students).toHaveLength(rowCount);

    for (const row of students) {
      const user = await userRepository.findByEmail(row.email);
      expect(user).toBeTruthy();
      expect(user.status).toBe('pending');
      const studentRow = await studentRepository.findByUserId(user.id);
      expect(studentRow).toBeTruthy();
      expect(studentRow.roll_number).toBe(row.roll);
    }
  });

  it('does not create a second row for an email that already has an account', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `BC2-${Date.now()}` });
    const { user: faculty, password } = await seedUser(userRepository, hashPassword, {
      role: 'faculty',
      institutionId: institution.id,
      email: `faculty2-${Date.now()}@example.com`,
    });
    const token = await login(faculty.email, password);

    const existingEmail = `existing-${Date.now()}@example.com`;
    await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: existingEmail,
    });

    const res = await request(app)
      .post('/api/v1/students/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ students: [{ name: 'Already Here', email: existingEmail, roll: 'EX-1' }] })
      .expect(201);

    expect(res.body.data.created).toBe(0);
    expect(res.body.data.students).toHaveLength(0);
  });
});
