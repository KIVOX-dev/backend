const BaseService = require('./BaseService');
const testAssignmentRepository = require('../repositories/testAssignment.repository');
const studentRepository = require('../repositories/student.repository');
const testRepository = require('../repositories/test.repository');
const questionRepository = require('../repositories/question.repository');
const assessmentAttemptRepository = require('../repositories/assessmentAttempt.repository');
const { applyTestResult } = require('../utils/studentStats');
const { ROLES } = require('../config/constants');
const { buildInstitutionFilter } = require('../utils/authz');
const ApiError = require('../utils/ApiError');

// Called once per student being assigned — $sample returns an independently
// random subset AND order every time it's called, so simply calling this
// once per student (rather than once per test) is what gives each of them a
// distinct pattern of questions, with no extra shuffling logic needed.
async function drawQuestionIds(test) {
  if (!test.source_category || !test.question_count) return [];
  const questions = await questionRepository.sampleRandom(test.source_category, test.question_count);
  return questions.map((q) => q.id);
}

// Some question-bank entries store the correct answer as an option letter
// ("B") rather than the option text itself — a backend twin of the
// resolveAnswer() helper the frontend already needed for the same reason.
function resolveAnswer(question) {
  const raw = String(question.answer || '');
  if (/^[A-D]$/i.test(raw.trim())) {
    const idx = raw.trim().toUpperCase().charCodeAt(0) - 65;
    return question.options?.[idx] ?? raw;
  }
  return raw;
}

async function assertOwnAssignment(assignmentId, actor) {
  const assignment = await testAssignmentRepository.findById(assignmentId);
  if (!assignment) throw ApiError.notFound('Assignment not found');
  const student = await studentRepository.findByUserId(actor.id);
  if (!student || assignment.student_id !== student.id) {
    throw ApiError.forbidden('You do not have access to this resource');
  }
  return { assignment, student };
}

class TestAssignmentService extends BaseService {
  constructor() {
    super(testAssignmentRepository, { entityName: 'Test assignment' });
  }

  async list(queryParams, actor) {
    let extraFilters;
    if (actor.role === ROLES.STUDENT) {
      const student = await studentRepository.findByUserId(actor.id);
      extraFilters = { student_id: student ? student.id : null };
    } else {
      extraFilters = buildInstitutionFilter(actor);
    }
    return super.list(queryParams, extraFilters);
  }

  // The institution-level check (assertInstitutionOwnership, via
  // BaseService#getById) isn't enough on its own here: it would still let one
  // student in an institution read another same-institution student's
  // assignment by guessing the id. Add the row-level check on top.
  async getById(id, actor) {
    const item = await super.getById(id, actor);
    if (actor.role === ROLES.STUDENT) {
      const student = await studentRepository.findByUserId(actor.id);
      if (!student || item.student_id !== student.id) {
        throw ApiError.forbidden('You do not have access to this resource');
      }
    }
    return item;
  }

  // student_id/institution_id are validated/derived server-side — a client
  // can never assign a test to a student outside the actor's own institution.
  async create(data, actor) {
    const test = await testRepository.findById(data.test_id);
    if (!test) throw ApiError.badRequest('test_id does not reference a valid test');

    if (data.student_id) {
      const student = await studentRepository.findById(data.student_id);
      if (!student) throw ApiError.badRequest('student_id does not reference a valid student');
      if (actor.role !== ROLES.SUPER_ADMIN && student.institution_id !== actor.institutionId) {
        throw ApiError.forbidden('You may only assign tests to students in your own institution');
      }
      return this.repository.create({
        test_id: data.test_id,
        student_id: data.student_id,
        scheduled_at: data.scheduled_at,
        institution_id: student.institution_id,
        assigned_by: actor.id,
        question_ids: await drawQuestionIds(test),
      });
    }

    // Bulk path — assign to every student in the actor's own institution
    // matching department_id + batch_year, instead of picking one at a time.
    // Joi's .and('department_id', 'batch_year') guarantees both are present
    // here since student_id is absent.
    if (!actor.institutionId) {
      throw ApiError.badRequest('Bulk assignment requires an institution-scoped actor');
    }
    const { rows: students } = await studentRepository.findAll({
      page: 1,
      limit: 1000,
      filters: {
        institution_id: actor.institutionId,
        department_id: data.department_id,
        batch_year: data.batch_year,
      },
    });
    if (students.length === 0) {
      throw ApiError.badRequest('No students match that department and batch year');
    }

    let assignedCount = 0;
    for (const student of students) {
      // Respects the existing unique (test_id, student_id) index —
      // re-assigning the same test to an already-assigned student is a
      // silent no-op, not a duplicate row or an error.
      const existing = await this.repository.findOne({ test_id: data.test_id, student_id: student.id });
      if (existing) continue;
      // Drawn per-student, inside the loop — each call to $sample is
      // independently random, which is what gives every student their own
      // distinct subset and order even though they share the same test.
      await this.repository.create({
        test_id: data.test_id,
        student_id: student.id,
        scheduled_at: data.scheduled_at,
        question_ids: await drawQuestionIds(test),
        institution_id: actor.institutionId,
        assigned_by: actor.id,
      });
      assignedCount += 1;
    }
    return { assigned_count: assignedCount, matched_students: students.length };
  }

  // Resolves this assignment's stored question_ids to full question content,
  // in the order they were drawn, with the correct answer stripped — the
  // scoring check in submit() below is the only place that ever reads it.
  async getQuestions(assignmentId, actor) {
    const { assignment } = await assertOwnAssignment(assignmentId, actor);
    const test = await testRepository.findById(assignment.test_id);
    const now = new Date();
    if (test?.start_at && now < new Date(test.start_at)) {
      throw ApiError.forbidden('This assessment has not started yet');
    }
    if (test?.end_at && now > new Date(test.end_at)) {
      throw ApiError.forbidden('This assessment has already ended');
    }

    const questionIds = assignment.question_ids || [];
    const questions = await questionRepository.findByIds(questionIds);
    const byId = new Map(questions.map((q) => [q.id, q]));
    return questionIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map(({ answer, ...rest }) => rest);
  }

  // Backend-computed scoring for a graded, admin-authored assessment — unlike
  // the practice-bank path (test.service.js#submitAttempt), the client's
  // self-reported score is never trusted here.
  async submitForAssignment(assignmentId, data, actor) {
    const { assignment, student } = await assertOwnAssignment(assignmentId, actor);
    if (assignment.status === 'completed') {
      throw ApiError.badRequest('This assessment has already been submitted');
    }
    const test = await testRepository.findById(assignment.test_id);
    if (test?.end_at && new Date() > new Date(test.end_at)) {
      throw ApiError.badRequest('This assessment window has closed');
    }

    const questionIds = assignment.question_ids || [];
    const questions = await questionRepository.findByIds(questionIds);
    const byId = new Map(questions.map((q) => [q.id, q]));

    let score = 0;
    for (const questionId of questionIds) {
      const question = byId.get(questionId);
      if (!question) continue;
      const submitted = data.answers?.[questionId];
      if (submitted && resolveAnswer(question) === submitted) score += 1;
    }
    const maxScore = questionIds.length;
    const percentage = maxScore ? Math.round((score / maxScore) * 10000) / 100 : 0;
    const attemptNumber = (await assessmentAttemptRepository.countForStudentAndTest(student.id, assignment.test_id)) + 1;

    const attempt = await assessmentAttemptRepository.create({
      test_id: assignment.test_id,
      student_id: student.id,
      institution_id: student.institution_id,
      attempt_number: attemptNumber,
      score,
      max_score: maxScore,
      percentage,
      passed: percentage >= (test?.pass_percentage != null ? test.pass_percentage : 40),
      completed_at: new Date(),
    });

    await this.repository.updateById(assignment.id, { status: 'completed' });
    await applyTestResult(student.id, percentage);
    return attempt;
  }
}

module.exports = new TestAssignmentService();
