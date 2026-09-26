const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// GET /leaderboard backs both the learner Top Talent Board and the HR Talent
// Board. It used to omit the numbers behind `score` (tests x accuracy), so the
// HR board showed "0 completed" and "Unknown" department for everyone.
describe('GET /leaderboard', () => {
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

  it('returns each student\'s tests, accuracy and department name, ranked by score with shared ranks for ties', async () => {
    const departmentRepository = require('../../repositories/department.repository');
    const institution = await seedInstitution(institutionRepository, { code: `LB-${Date.now()}` });
    const dept = await departmentRepository.create({ institution_id: institution.id, name: 'Computer Science and Engineering', code: 'CSE' });

    const students = [
      { name: 'Asha', tests: 10, accuracy: 80 }, // score 800
      { name: 'Bala', tests: 4, accuracy: 90 }, //  score 360
      { name: 'Chitra', tests: 4, accuracy: 90 }, // score 360 (tie with Bala)
    ];
    for (const s of students) {
      const { user } = await seedUser(userRepository, hashPassword, {
        role: 'student',
        institutionId: institution.id,
        email: `lb-${s.name}-${Date.now()}@example.com`,
        full_name: `LB ${s.name}`,
      });
      await studentRepository.create({
        user_id: user.id,
        institution_id: institution.id,
        department_id: dept.id,
        tests_completed: s.tests,
        avg_accuracy: s.accuracy,
      });
    }

    const { user: hr, password } = await seedUser(userRepository, hashPassword, {
      role: 'hr',
      email: `lb-hr-${Date.now()}@example.com`,
    });
    const login = await request(app).post('/api/v1/auth/login').send({ email: hr.email, password }).expect(200);

    const res = await request(app)
      .get('/api/v1/leaderboard')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);

    const rows = res.body.data.data.filter((r) => r.name.startsWith('LB '));
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName['LB Asha']).toMatchObject({ tests_completed: 10, accuracy: 80, score: 800, department: 'Computer Science and Engineering' });
    expect(byName['LB Bala'].tests_completed).toBe(4);
    // Ties share a rank; the higher score ranks strictly above them.
    expect(byName['LB Bala'].rank).toBe(byName['LB Chitra'].rank);
    expect(byName['LB Asha'].rank).toBeLessThan(byName['LB Bala'].rank);
  });
});
