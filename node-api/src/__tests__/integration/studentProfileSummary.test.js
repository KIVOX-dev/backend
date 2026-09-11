const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// GET /api/v1/students/profile/summary backs the AI Profile Summarizer
// (ProfileSummarizer.tsx), which used to render entirely hardcoded numbers.
// This endpoint computes real numbers from this student's own assessment
// attempts, interview attempts, and resume — these tests pin the
// aggregation math (per-category averages, top skill/weakness picking,
// interview 0-10 -> 0-100 scaling, resume-section completeness, and the
// "no data yet" empty state) so it doesn't silently drift.
describe('GET /students/profile/summary', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let studentRepository;
  let hashPassword;
  let testRepository;
  let assessmentAttemptRepository;
  let interviewAttemptRepository;
  let resumeBuilderRepository;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, studentRepository, hashPassword } = await buildTestApp());
    // Required only after buildTestApp()'s jest.resetModules() + connect()
    // have run — same reasoning as testApp.js's own repository requires:
    // anything required before that reset binds to a database.js module
    // instance that never gets connect() called on it.
    testRepository = require('../../repositories/test.repository');
    assessmentAttemptRepository = require('../../repositories/assessmentAttempt.repository');
    interviewAttemptRepository = require('../../repositories/interviewAttempt.repository');
    resumeBuilderRepository = require('../../repositories/resumeBuilder.repository');
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function login(email, password) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.data.accessToken;
  }

  it('returns the empty state for a student with no attempts, interviews, or resume yet', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `PS-EMPTY-${Date.now()}` });
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `empty-${Date.now()}@example.com`,
    });
    await studentRepository.create({ user_id: user.id, institution_id: institution.id });

    const token = await login(user.email, password);
    const res = await request(app)
      .get('/api/v1/students/profile/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.has_data).toBe(false);
    expect(res.body.data.overall_readiness).toBe(0);
    expect(res.body.data.top_skill).toBeNull();
    expect(res.body.data.category_trends).toEqual([]);
  });

  it('aggregates real attempts/interviews/resume into the summary', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `PS-DATA-${Date.now()}` });
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `data-${Date.now()}@example.com`,
    });
    const student = await studentRepository.create({ user_id: user.id, institution_id: institution.id });

    const quantTest = await testRepository.create({
      institution_id: institution.id,
      title: 'Quantitative Aptitude Practice',
      category: 'quantitative',
    });
    const verbalTest = await testRepository.create({
      institution_id: institution.id,
      title: 'Verbal Ability Practice',
      category: 'verbal',
    });

    const now = new Date();
    await assessmentAttemptRepository.create({
      test_id: quantTest.id, student_id: student.id, institution_id: institution.id,
      percentage: 90, status: 'completed', completed_at: now,
    });
    await assessmentAttemptRepository.create({
      test_id: quantTest.id, student_id: student.id, institution_id: institution.id,
      percentage: 70, status: 'completed', completed_at: now,
    });
    await assessmentAttemptRepository.create({
      test_id: verbalTest.id, student_id: student.id, institution_id: institution.id,
      percentage: 40, status: 'completed', completed_at: now,
    });
    // An in-progress attempt must not count toward the averages.
    await assessmentAttemptRepository.create({
      test_id: verbalTest.id, student_id: student.id, institution_id: institution.id,
      percentage: 10, status: 'in_progress', completed_at: now,
    });

    await interviewAttemptRepository.create({
      student_id: student.id, institution_id: institution.id, overall_rating: 8,
    });

    await resumeBuilderRepository.create({
      student_id: student.id, institution_id: institution.id,
      personal: { name: 'Test Student', email: user.email },
      education: [{ school: 'Test University' }],
      skills: ['JavaScript'],
      // objective, experience, projects intentionally left unfilled
    });

    const token = await login(user.email, password);
    const res = await request(app)
      .get('/api/v1/students/profile/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body.data;
    expect(body.has_data).toBe(true);
    // Quant: (90 + 70) / 2 = 80. Verbal: 40 (in_progress excluded).
    expect(body.top_skill).toBe('Quantitative Aptitude');
    expect(body.weakness).toBe('Verbal Ability');
    expect(body.ideal_role).toBe('Data Analyst');
    // Aptitude avg across all 3 completed attempts: (90+70+40)/3 = 66.67 -> 67.
    expect(body.aptitude_pct).toBe(67);
    // Interview: 8/10 -> 80%.
    expect(body.interview_pct).toBe(80);
    // Resume: 3 of 6 tracked sections filled (personal, education, skills) -> 50%.
    expect(body.resume_pct).toBe(50);
    // Overall: average of the 3 pillars that have data: (67 + 80 + 50) / 3 = 65.67 -> 66.
    expect(body.overall_readiness).toBe(66);
    expect(body.executive_summary).toContain('3 practice attempts');

    const quant = body.category_trends.find((c) => c.category === 'quantitative');
    expect(quant.avg_percentage).toBe(80);
    expect(quant.attempts).toBe(2);
  });
});
