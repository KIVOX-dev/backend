const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Course import itself needs YOUTUBE_API_KEY (never set in this suite — see
// courses.test.js), so these tests seed courses/lessons directly through the
// repositories instead, the same way this suite would need to regardless
// since the AI service is also unreachable here (the assessment falls back
// to test.service.js's single-placeholder-question shape either way — see
// course.service.js#_generateQuestions's fallback). That fallback question's
// correct_answer is always 'A', which is what makes a scripted "answer with
// A every time" pass reliably in a test with no real AI service behind it.
describe('Skill badges and certificates (YouTube to Course assessments)', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let studentRepository;
  let hashPassword;
  let courseRepository;
  let lessonRepository;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, studentRepository, hashPassword } = await buildTestApp());
    courseRepository = require('../../repositories/course.repository');
    lessonRepository = require('../../repositories/lesson.repository');
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function login(email, password) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.data.accessToken;
  }

  async function seedStudent(institutionId) {
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId,
      email: `skill-student-${Date.now()}-${Math.random()}@example.com`,
    });
    const student = await studentRepository.create({
      user_id: user.id,
      institution_id: institutionId,
      phone: '555-0100',
      date_of_birth: '2000-01-01',
      gender: 'female',
      address: '123 Test St',
      cgpa: 8.5,
    });
    return { user, password, student };
  }

  // Bypasses /courses/import (needs a real YOUTUBE_API_KEY) — creates the
  // course/lesson rows directly, same shape course.service.js#import would.
  async function seedLesson(studentId, title) {
    const course = await courseRepository.create({
      student_id: studentId,
      title,
      source_type: 'video',
      source_url: 'https://www.youtube.com/watch?v=test',
      lesson_count: 1,
      total_duration_seconds: 60,
    });
    const lesson = await lessonRepository.create({
      course_id: course.id,
      youtube_video_id: 'test',
      title,
      duration_seconds: 60,
      position: 0,
    });
    return { course, lesson };
  }

  async function passAssessment(token, courseId, lessonId) {
    // First GET generates+caches the (fallback, single-question) quiz and
    // tags skill_name from the title — see course.service.js#getLessonAssessment.
    const assessment = await request(app)
      .get(`/api/v1/courses/${courseId}/lessons/${lessonId}/assessment`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const answers = assessment.body.data.questions.map(() => 'A');
    return request(app)
      .post(`/api/v1/courses/${courseId}/lessons/${lessonId}/assessment/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answers })
      .expect(200);
  }

  it('passing a lesson tagged with a catalog skill awards one badge', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `SKB-${Date.now()}` });
    const { user, password, student } = await seedStudent(institution.id);
    const token = await login(user.email, password);
    const { course, lesson } = await seedLesson(student.id, 'Python Full Course for Beginners');

    const res = await passAssessment(token, course.id, lesson.id);
    expect(res.body.data.skill_progress).toMatchObject({ skill_name: 'Python', badge_count: 1, newly_earned: true, certificate_issued: false });

    const badges = await request(app).get('/api/v1/students/profile/skill-badges').set('Authorization', `Bearer ${token}`).expect(200);
    expect(badges.body.data).toEqual([
      expect.objectContaining({ skill_name: 'Python', badge_count: 1, certificate_issued: false, badges_remaining: 4 }),
    ]);
  });

  it('a lesson title matching no catalog skill awards nothing (no crash)', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `SKN-${Date.now()}` });
    const { user, password, student } = await seedStudent(institution.id);
    const token = await login(user.email, password);
    const { course, lesson } = await seedLesson(student.id, 'A Totally Generic Video Title');

    const res = await passAssessment(token, course.id, lesson.id);
    expect(res.body.data.skill_progress).toBeNull();

    const badges = await request(app).get('/api/v1/students/profile/skill-badges').set('Authorization', `Bearer ${token}`).expect(200);
    expect(badges.body.data).toEqual([]);
  });

  it('retaking the same lesson does not inflate the badge count', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `SKR-${Date.now()}` });
    const { user, password, student } = await seedStudent(institution.id);
    const token = await login(user.email, password);
    const { course, lesson } = await seedLesson(student.id, 'React Crash Course');

    await passAssessment(token, course.id, lesson.id);
    const second = await passAssessment(token, course.id, lesson.id);
    expect(second.body.data.skill_progress).toMatchObject({ skill_name: 'React', badge_count: 1, newly_earned: false });
  });

  it('5 distinct passing lessons of the same skill issue a real, verifiable certificate', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `SKC-${Date.now()}` });
    const { user, password, student } = await seedStudent(institution.id);
    const token = await login(user.email, password);

    let lastRes;
    for (let i = 1; i <= 5; i += 1) {
      const { course, lesson } = await seedLesson(student.id, `SQL Tutorial Part ${i}`);
      lastRes = await passAssessment(token, course.id, lesson.id);
    }
    expect(lastRes.body.data.skill_progress).toMatchObject({ skill_name: 'SQL', badge_count: 5, certificate_issued: true });

    const certificates = await request(app).get('/api/v1/students/profile/certificates').set('Authorization', `Bearer ${token}`).expect(200);
    expect(certificates.body.data).toHaveLength(1);
    const certificate = certificates.body.data[0];
    expect(certificate).toMatchObject({ skill_name: 'SQL' });
    expect(certificate.linkedin_add_url).toContain('linkedin.com/profile/add');
    expect(certificate.linkedin_add_url).toContain('startTask=CERTIFICATION_NAME');
    expect(certificate.verify_url).toContain(`/verify/${certificate.id}`);

    // Public — no Authorization header — same as a recruiter clicking the link.
    const verify = await request(app).get(`/api/v1/certificates/${certificate.id}/verify`).expect(200);
    expect(verify.body.data).toMatchObject({ id: certificate.id, skill_name: 'SQL', student_name: user.name || user.full_name });
  });

  it('GET /certificates/:id/verify 404s for an unknown id', async () => {
    await request(app).get('/api/v1/certificates/00000000-0000-0000-0000-000000000000/verify').expect(404);
  });
});
