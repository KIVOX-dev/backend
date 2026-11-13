const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Server-owned exam session: the clock starts on the first question fetch,
// answers autosave and survive a "crash", reported connection loss is verified
// against the server's own last-contact time and recorded (never penalised),
// and a submission past deadline + grace scores the last autosave instead of
// trusting the browser.
describe('exam session (autosave / resume / server clock)', () => {
  let app;
  let database;
  let repos;
  let institution;
  let token;
  let assignmentId;
  let questionIds;

  const MIN = 60 * 1000;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const built = await buildTestApp();
    app = built.app;
    database = built.database;
    repos = {
      department: require('../../repositories/department.repository'),
      test: require('../../repositories/test.repository'),
      assignment: require('../../repositories/testAssignment.repository'),
      question: require('../../repositories/question.repository'),
      attempt: require('../../repositories/assessmentAttempt.repository'),
    };
    for (let i = 0; i < 4; i++) {
      await repos.question.create({ category: 'verbal', question: `Q${i}`, options: ['a', 'b', 'c', 'd'], answer: 'a' });
    }
    institution = await seedInstitution(built.institutionRepository, { code: `ES-${Date.now()}` });
    const department = await repos.department.create({ institution_id: institution.id, name: 'CSE', code: 'CSE' });
    const { user, password } = await seedUser(built.userRepository, built.hashPassword, {
      role: 'student', institutionId: institution.id, email: `es-student-${Date.now()}@example.com`,
    });
    const student = await built.studentRepository.create({
      user_id: user.id, institution_id: institution.id, department_id: department.id, batch_year: 2030, roll_number: 'ES-1',
    });
    const test = await repos.test.create({
      institution_id: institution.id, title: 'Session Test', source_category: 'verbal', question_count: 4, duration_minutes: 30,
    });
    const assignment = await repos.assignment.create({
      test_id: test.id, student_id: student.id, institution_id: institution.id,
      question_ids: (await repos.question.sampleRandom('verbal', 4)).map((q) => q.id),
    });
    assignmentId = assignment.id;
    questionIds = assignment.question_ids;
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    token = res.body.data.accessToken;
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  it('autosave is refused before the exam has started', async () => {
    await request(app).put(`/api/v1/test-assignments/${assignmentId}/autosave`).set(auth()).send({ answers: {} }).expect(400);
  });

  it('first question fetch starts the server clock', async () => {
    await request(app).get(`/api/v1/test-assignments/${assignmentId}/questions`).set(auth()).expect(200);
    const row = await repos.assignment.findById(assignmentId);
    expect(row.started_at).toBeTruthy();
    expect(row.status).toBe('in_progress');
  });

  it('autosaves answers and restores them via the session endpoint', async () => {
    const answers = { [questionIds[0]]: 'a', [questionIds[1]]: 'b' };
    await request(app).put(`/api/v1/test-assignments/${assignmentId}/autosave`).set(auth()).send({ answers }).expect(200);
    const res = await request(app).get(`/api/v1/test-assignments/${assignmentId}/session`).set(auth()).expect(200);
    expect(res.body.data.saved_answers).toEqual(answers);
    expect(res.body.data.remaining_seconds).toBeGreaterThan(29 * 60);
  });

  it('records a reported connection loss only when the server saw a real gap, and credits the time', async () => {
    // Simulate 5 minutes of silence on the server's own record.
    await repos.assignment.updateById(assignmentId, { last_heartbeat_at: new Date(Date.now() - 5 * MIN) });
    const res = await request(app)
      .put(`/api/v1/test-assignments/${assignmentId}/autosave`)
      .set(auth())
      .send({ answers: { [questionIds[0]]: 'a' }, reconnected: true })
      .expect(200);
    const row = await repos.assignment.findById(assignmentId);
    expect(row.pauses).toHaveLength(1);
    expect(row.pauses[0].reason).toBe('connection_lost');
    expect(row.pauses[0].credited_ms).toBeGreaterThan(4.9 * MIN);
    expect(res.body.data.remaining_seconds).toBeGreaterThan(33 * 60); // 30 min + ~5 min credit - elapsed
  });

  it('a "reconnected" claim with no real silence records nothing', async () => {
    await request(app)
      .put(`/api/v1/test-assignments/${assignmentId}/autosave`)
      .set(auth())
      .send({ answers: {}, reconnected: true })
      .expect(200);
    const row = await repos.assignment.findById(assignmentId);
    expect(row.pauses).toHaveLength(1);
  });

  it('past deadline + grace, scores the last autosave (not the browser payload) and marks it late', async () => {
    await repos.assignment.updateById(assignmentId, {
      saved_answers: { [questionIds[0]]: 'a', [questionIds[1]]: 'a' },
      started_at: new Date(Date.now() - 60 * MIN),
      last_heartbeat_at: new Date(),
      pauses: [],
    });
    const res = await request(app)
      .post(`/api/v1/test-assignments/${assignmentId}/submit`)
      .set(auth())
      .send({ answers: { [questionIds[2]]: 'a', [questionIds[3]]: 'a' } }) // would be 2 more correct if trusted
      .expect(201);
    expect(res.body.data.late_submission).toBe(true);
    expect(res.body.data.score).toBe(2); // only the two autosaved answers
    expect(res.body.data.status).toBe('completed'); // late/offline is never malpractice
    const row = await repos.assignment.findById(assignmentId);
    expect(row.status).toBe('completed');
  });

  it('a second submission is rejected', async () => {
    await request(app).post(`/api/v1/test-assignments/${assignmentId}/submit`).set(auth()).send({ answers: {} }).expect(400);
  });
});
