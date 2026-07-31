const BaseService = require('./BaseService');
const testRepository = require('../repositories/test.repository');
const assessmentAttemptRepository = require('../repositories/assessmentAttempt.repository');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const testAssignmentRepository = require('../repositories/testAssignment.repository');
const { applyTestResult } = require('../utils/studentStats');
const { isGroqConfigured, groqComplete } = require('../utils/groqClient');
const { buildInstitutionFilter } = require('../utils/authz');
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
    if (payload.start_at && payload.end_at && new Date(payload.end_at) <= new Date(payload.start_at)) {
      throw ApiError.badRequest('End date must be after the start date');
    }
    return this.repository.create(payload);
  }

  // A student's own list is gated: open practice-bank tests (category set)
  // are visible unconditionally, everything else only if explicitly
  // assigned to them via test_assignments. Every other role gets the plain
  // institution-scoped list (or everything, for super_admin).
  async list(queryParams, actor) {
    if (actor.role !== ROLES.STUDENT) {
      return super.list(queryParams, buildInstitutionFilter(actor));
    }

    const student = await studentRepository.findByUserId(actor.id);
    if (!student) return { rows: [], meta: { page: 1, limit: 20, total: 0 } };

    const { rows: assignments } = await testAssignmentRepository.findAll({
      page: 1,
      limit: 1000,
      filters: { student_id: student.id },
    });
    const assignedTestIds = assignments.map((a) => a.test_id);
    // A student is only ever assigned a given test once (unique index on
    // test_id+student_id), so this map is safe to key by test_id alone.
    const assignmentByTestId = new Map(assignments.map((a) => [a.test_id, a]));

    const page = Math.max(parseInt(queryParams.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(queryParams.limit, 10) || 20, 1), 100);
    const { rows, total } = await testRepository.findVisibleToStudent(
      student.institution_id,
      assignedTestIds,
      { page, limit }
    );
    // Practice-bank tests (category set) have no assignment — the frontend
    // uses assignment_id being null to know to keep using the old
    // description-parse + /tests/submit path for those.
    const enrichedRows = rows.map((row) => ({
      ...row,
      assignment_id: assignmentByTestId.get(row.id)?.id ?? null,
    }));
    return { rows: enrichedRows, meta: { page, limit, total } };
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

  // Attempt rows only ever carry a `student_id` (the students collection's
  // own row id, not the users collection's id) — resolved here to a display
  // name server-side so the admin's Results view never has to (and can't
  // silently mis-join by comparing the wrong id space).
  async getResults(testId, actor) {
    const filters = { test_id: testId };
    if (actor.role !== ROLES.SUPER_ADMIN) filters.institution_id = actor.institutionId;
    const { rows } = await assessmentAttemptRepository.findAll({ page: 1, limit: 1000, filters });

    const students = await studentRepository.findByIds(rows.map((r) => r.student_id));
    const studentById = new Map(students.map((s) => [s.id, s]));
    const users = await userRepository.findByIds(students.map((s) => s.user_id));
    const userById = new Map(users.map((u) => [u.id, u]));

    return rows.map((r) => {
      const student = studentById.get(r.student_id);
      const user = student ? userById.get(student.user_id) : null;
      return { ...r, student_name: user?.full_name || 'Unknown student' };
    });
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
