const BaseService = require('./BaseService');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const institutionRepository = require('../repositories/institution.repository');
const assessmentAttemptRepository = require('../repositories/assessmentAttempt.repository');
const interviewAttemptRepository = require('../repositories/interviewAttempt.repository');
const interviewResponseRepository = require('../repositories/interviewResponse.repository');
const testRepository = require('../repositories/test.repository');
const userService = require('./user.service');
const { applyTestResult } = require('../utils/studentStats');
const { findOrCreateStudentUser } = require('../utils/studentOnboarding');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const RECENT_LIMIT = 5;
const HISTORY_LIMIT = 100;
const STAFF_ROLES = [ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY];

// The self-service learner routes (/students/:id/dashboard, /:id/tests, etc.)
// are all called by the frontend with the logged-in user's own `user.id`
// (the only id it has from authStore) rather than the separate `students`
// collection's own row id — the two are different uuids. Every one of these
// lookups used to be a bare findById(studentId), which 404'd for every real
// caller. Falling back to findByUserId keeps any hypothetical caller that
// already has the real student id working too.
async function resolveStudent(id) {
  return (await studentRepository.findById(id)) || (await studentRepository.findByUserId(id));
}

function canActOnStudent(actor, student) {
  if (actor.role === ROLES.SUPER_ADMIN) return true;
  if (actor.role === ROLES.STUDENT) return student.user_id === actor.id;
  return student.institution_id === actor.institutionId;
}

class StudentService extends BaseService {
  constructor() {
    super(studentRepository, { entityName: 'Student' });
  }

  // Ported from python-service's students.py list_students (search by
  // name/email, filter by department/batch year). Falls back to the plain
  // BaseService list when no search/department filter is given, since that
  // path doesn't need the users join.
  async list(queryParams, actor) {
    const { search, department, batch_year: batchYear, ...rest } = queryParams;
    if (!search && !department) {
      return super.list(rest, actor.role === ROLES.SUPER_ADMIN ? {} : { institution_id: actor.institutionId });
    }
    const rows = await studentRepository.searchWithUsers({
      institutionId: actor.role === ROLES.SUPER_ADMIN ? undefined : actor.institutionId,
      search,
      department,
      batchYear: batchYear ? Number(batchYear) : undefined,
      limit: Math.min(Number(queryParams.limit) || 100, 1000),
    });
    return { rows, meta: { page: 1, limit: rows.length, total: rows.length } };
  }

  // Kiosk/verification lookup by human-typed college name + roll number —
  // ported from python-service's POST /students/identify. Intentionally
  // unauthenticated (a check-in kiosk has no login), but the response is
  // deliberately minimal (name + college + a verified flag only) and the
  // route is rate-limited — see routes/student.routes.js#/identify. Never
  // return internal ids, department, batch year, or performance stats here.
  async identify({ collegeName, rollNumber }, context = {}) {
    const institution = await institutionRepository.findByNameRegex(String(collegeName || '').trim());
    if (!institution) {
      logger.info('Student identify lookup: college not found', { collegeName, rollNumber, ip: context.ip });
      throw ApiError.notFound('Student not found');
    }

    const student = await studentRepository.findByRollNumber(String(rollNumber || '').trim().toUpperCase());
    if (!student || student.institution_id !== institution.id) {
      logger.info('Student identify lookup: no match', { collegeName, rollNumber, ip: context.ip });
      throw ApiError.notFound('Student not found');
    }

    const user = await userRepository.findById(student.user_id);
    if (!user) {
      logger.info('Student identify lookup: no match', { collegeName, rollNumber, ip: context.ip });
      throw ApiError.notFound('Student not found');
    }

    logger.info('Student identify lookup: matched', { collegeName, rollNumber, ip: context.ip });
    return {
      name: user.full_name,
      college: institution.name,
      verified: true,
    };
  }

  async dashboard(studentId) {
    const student = await resolveStudent(studentId);
    if (!student) throw ApiError.notFound('Student not found');

    const { rows: attempts } = await assessmentAttemptRepository.findAll({
      page: 1,
      limit: RECENT_LIMIT,
      filters: { student_id: student.id },
    });
    // One $in query instead of one findById per attempt (RECENT_LIMIT is
    // small today, but this scales flat regardless of how large it grows).
    const tests = await testRepository.findByIds(attempts.map((a) => a.test_id));
    const testById = new Map(tests.map((t) => [t.id, t]));
    const recentActivity = attempts.map((a) => {
      const test = testById.get(a.test_id);
      return {
        id: a.id,
        title: test ? test.title : 'Practice Test',
        score: a.score || 0,
        max_score: a.max_score || 100,
        percentage: a.percentage || 0,
        date: a.completed_at,
      };
    });

    return {
      tests_completed: student.tests_completed || 0,
      avg_accuracy: Math.round((student.avg_accuracy || 0) * 10) / 10,
      interviews_completed: student.interviews_completed || 0,
      streak: student.streak_days || 0,
      national_rank: '-', // computed leaderboard rank, not a stored field — see achievements migration
      placement_status: student.placement_status || null,
      recent_activity: recentActivity,
    };
  }

  async listTests(studentId, actor) {
    const student = await resolveStudent(studentId);
    if (!student) throw ApiError.notFound('Student not found');
    if (!canActOnStudent(actor, student)) throw ApiError.forbidden('Not authorized');

    const { rows } = await assessmentAttemptRepository.findAll({
      page: 1,
      limit: HISTORY_LIMIT,
      filters: { student_id: student.id },
    });
    return rows;
  }

  // python-service's log_student_test had NO auth/ownership check at all —
  // any authenticated (or even unauthenticated, per that route's missing
  // Depends) caller could log a test result for an arbitrary student_id.
  // Restricted here to the student themself or staff in the same institution
  // — same "fix immediately" call as placementRecord.service.js#create.
  async logTest(studentId, data, actor) {
    const student = await resolveStudent(studentId);
    if (!student) throw ApiError.notFound('Student not found');
    if (actor.role !== ROLES.STUDENT && !STAFF_ROLES.includes(actor.role)) {
      throw ApiError.forbidden('Not authorized');
    }
    if (!canActOnStudent(actor, student)) throw ApiError.forbidden('Not authorized');

    const score = Number(data.score) || 0;
    const maxScore = Number(data.max_score || data.total) || 100;
    const percentage = data.percentage != null ? Number(data.percentage) : Math.round((score / maxScore) * 10000) / 100;

    let test = data.test_id ? await testRepository.findById(data.test_id) : null;
    if (!test) {
      test = await testRepository.create({
        title: data.test_name || data.title || 'Practice Test',
        test_type: 'mixed',
        institution_id: student.institution_id,
        created_by: student.user_id,
        duration_minutes: Number(data.duration) || 30,
        total_marks: maxScore,
      });
    }

    const attemptNumber = (await assessmentAttemptRepository.countForStudentAndTest(student.id, test.id)) + 1;
    await assessmentAttemptRepository.create({
      test_id: test.id,
      student_id: student.id,
      institution_id: student.institution_id,
      attempt_number: attemptNumber,
      score,
      max_score: maxScore,
      percentage,
      passed: percentage >= 40,
      completed_at: new Date(),
    });

    await applyTestResult(student.id, percentage);
  }

  async testAnalytics(studentId) {
    const student = await resolveStudent(studentId);
    if (!student) throw ApiError.notFound('Student not found');

    const { rows: attempts, total } = await assessmentAttemptRepository.findAll({
      page: 1,
      limit: HISTORY_LIMIT,
      filters: { student_id: student.id },
    });
    const average = attempts.length
      ? Math.round((attempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / attempts.length) * 100) / 100
      : 0;
    return { attempts: total, average, history: attempts };
  }

  async listInterviews(studentId, actor) {
    const student = await resolveStudent(studentId);
    if (!student) throw ApiError.notFound('Student not found');
    if (!canActOnStudent(actor, student)) throw ApiError.forbidden('Not authorized');

    const { rows } = await interviewAttemptRepository.findAll({
      page: 1,
      limit: HISTORY_LIMIT,
      filters: { student_id: student.id },
    });
    return rows;
  }

  async logInterview(studentId, data) {
    const student = await resolveStudent(studentId);
    if (!student) throw ApiError.notFound('Student not found');

    const attemptNumber = (await interviewAttemptRepository.countForStudent(student.id)) + 1;
    const attempt = await interviewAttemptRepository.create({
      student_id: student.id,
      institution_id: student.institution_id,
      role: data.role,
      category: data.category || 'technical',
      overall_rating: data.overall_rating,
      strengths: data.strengths || [],
      improvements: data.improvements || [],
      duration_seconds: data.duration_seconds,
      attempt_number: attemptNumber,
    });

    await Promise.all(
      (data.responses || []).map((r) =>
        interviewResponseRepository.create({
          attempt_id: attempt.id,
          question_id: r.question_id,
          question_text: r.question_text,
          answer_text: r.answer_text,
          score: r.score,
          rating: r.rating,
          feedback: r.feedback,
          time_taken_seconds: r.time_taken_seconds,
        })
      )
    );

    await studentRepository.updateById(student.id, {
      interviews_completed: (student.interviews_completed || 0) + 1,
    });
    return attempt;
  }

  // Lighter-weight than a full batch-roster import (see the standalone
  // batches.py migration checkpoint) — just onboards users + student rows,
  // no batch/batch_students tracking docs. Ported from python-service's
  // POST /students/batch.
  async batchCreate({ students = [], department, department_id: departmentId, year }, actor) {
    const defaultStatus = actor.role === ROLES.FACULTY ? 'pending' : 'approved';
    let created = 0;
    const createdStudents = [];

    for (const item of students) {
      const { user, created: wasCreated, tempPassword } = await findOrCreateStudentUser({
        item,
        institutionId: actor.institutionId,
        department,
        departmentId,
        year,
        status: defaultStatus,
      });
      if (wasCreated) {
        created += 1;
        if (tempPassword) createdStudents.push({ id: user.id, email: user.email, name: user.full_name, tempPassword });
      }
    }

    return { created, status: defaultStatus, students: createdStudents };
  }

  // Delegates to the users merge's tiered pending-list logic (see
  // user.service.js#listPending) with an injected role filter — students.py's
  // /students/pending is the same query as users.py's /users/pending, just
  // pre-filtered to one role.
  async listPending(queryParams, actor) {
    return userService.listPending({ ...queryParams, role: ROLES.STUDENT }, actor);
  }
}

module.exports = new StudentService();
