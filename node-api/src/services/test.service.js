const BaseService = require('./BaseService');
const testRepository = require('../repositories/test.repository');
const assessmentAttemptRepository = require('../repositories/assessmentAttempt.repository');
const studentRepository = require('../repositories/student.repository');
const { applyTestResult } = require('../utils/studentStats');
const { isGroqConfigured, groqComplete } = require('../utils/groqClient');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const QUESTION_GEN_SYSTEM_PROMPT = `You are an expert curriculum designer. Generate exactly 10
multiple-choice questions as a raw JSON object: {"questions": [...]}. Each item must have
"question" (string), "options" (array of exactly 4 strings), and "correct_answer" (string,
must match one of the options). No markdown, no text outside the JSON.`;

class TestService extends BaseService {
  constructor() {
    super(testRepository, { entityName: 'Test' });
  }

  async create(data, actor) {
    const payload = { ...data, created_by: actor.id };
    if (actor.role === ROLES.FACULTY || actor.role === ROLES.INSTITUTION_ADMIN) {
      payload.institution_id = actor.institutionId;
    }
    return this.repository.create(payload);
  }

  // Ported from python-service's assessments.py#generate_assessment_questions.
  // Soft-fallback (a single placeholder question) when Groq isn't configured —
  // matches python exactly, unlike resume.py's endpoints which hard-fail instead.
  async generateQuestions({ title = 'Assessment', type = 'general', difficulty = 'medium' }) {
    if (!isGroqConfigured()) {
      return {
        questions: [
          {
            question: `Sample ${difficulty} ${type} question for ${title}`,
            options: ['A', 'B', 'C', 'D'],
            correct_answer: 'A',
          },
        ],
      };
    }

    try {
      const result = await groqComplete({
        systemPrompt: QUESTION_GEN_SYSTEM_PROMPT,
        userPrompt: `Title: "${title}"\nType: ${type}\nDifficulty: ${difficulty}`,
        temperature: 0.7,
        maxTokens: 2048,
        jsonResponse: true,
      });
      return { questions: result.questions || [] };
    } catch (err) {
      logger.error('Question generation failed', { error: err.message });
      throw ApiError.internal('Failed to generate questions');
    }
  }

  async overviewStats(actor) {
    const extraFilters = actor.role === ROLES.SUPER_ADMIN ? {} : { institution_id: actor.institutionId };
    const { meta } = await super.list({ limit: 1 }, extraFilters);
    const total = meta.total;

    const attemptFilters = actor.role === ROLES.SUPER_ADMIN ? {} : { institution_id: actor.institutionId };
    const { rows: attempts } = await assessmentAttemptRepository.findAll({ page: 1, limit: 10000, filters: attemptFilters });
    const avgScore = attempts.length
      ? Math.round((attempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / attempts.length) * 100) / 100
      : 0;

    return { total, attempts: attempts.length, avg_score: avgScore };
  }

  async getResults(testId, actor) {
    const filters = { test_id: testId };
    if (actor.role !== ROLES.SUPER_ADMIN) filters.institution_id = actor.institutionId;
    const { rows } = await assessmentAttemptRepository.findAll({ page: 1, limit: 1000, filters });
    return rows;
  }

  // Institution-wide attempts across every test, not just one — ported from
  // python-service's tests.py#college_results.
  async collegeResults(actor) {
    const filters = actor.role === ROLES.SUPER_ADMIN ? {} : { institution_id: actor.institutionId };
    const { rows } = await assessmentAttemptRepository.findAll({ page: 1, limit: 1000, filters });
    return rows;
  }

  // Student self-submits a completed attempt — no pre-existing test-assignment
  // required. Ported from python-service's assessments.py#submit_test (also
  // reused by tests.py's /tests/submit, which is a pure pass-through there —
  // node-api's /tests/submit route calls this same method directly instead).
  async submitAttempt(data, actor) {
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.badRequest('No student profile is linked to this account');

    let test = data.test_id ? await testRepository.findById(data.test_id) : null;
    if (!test) {
      test = await testRepository.create({
        title: 'Practice Test',
        test_type: 'mixed',
        institution_id: student.institution_id,
        created_by: actor.id,
        duration_minutes: 30,
        total_marks: data.max_score,
      });
    }

    const percentage = data.percentage != null ? data.percentage : Math.round((data.score / data.max_score) * 10000) / 100;
    const attemptNumber = (await assessmentAttemptRepository.countForStudentAndTest(student.id, test.id)) + 1;

    const attempt = await assessmentAttemptRepository.create({
      test_id: test.id,
      student_id: student.id,
      institution_id: student.institution_id || test.institution_id,
      attempt_number: attemptNumber,
      score: data.score,
      max_score: data.max_score,
      percentage,
      time_taken_seconds: data.time_taken_seconds,
      passed: percentage >= (test.pass_percentage != null ? test.pass_percentage : 40),
      section_scores: data.section_scores,
      weak_areas: data.weak_areas,
      completed_at: new Date(),
    });

    await applyTestResult(student.id, percentage);
    return attempt;
  }
}

module.exports = new TestService();
