const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const testRepository = require('../repositories/test.repository');
const assessmentAttemptRepository = require('../repositories/assessmentAttempt.repository');
const interviewAttemptRepository = require('../repositories/interviewAttempt.repository');
const placementRecordRepository = require('../repositories/placementRecord.repository');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');

const RECENT_LIMIT = 5;
const HISTORY_LIMIT = 100;

class DashboardService {
  // Distinct from student.service.js#dashboard (students.py's own dashboard
  // endpoint, which reads cached stats off the students row) — this mirrors
  // dashboard.py's version, computed fresh via aggregation over attempts.
  async studentDashboard(studentId) {
    const student = await studentRepository.findById(studentId);
    if (!student) throw ApiError.notFound('Student not found');

    const [stats, history, interviewsCompleted, placements] = await Promise.all([
      assessmentAttemptRepository.aggregateStatsForStudent(studentId),
      assessmentAttemptRepository.recentForStudent(studentId, HISTORY_LIMIT),
      interviewAttemptRepository.countForStudent(studentId),
      placementRecordRepository.countForStudent(studentId),
    ]);

    return {
      tests_completed: stats.tests_completed,
      avg_accuracy: stats.avg_accuracy,
      interviews_completed: interviewsCompleted,
      placements,
      recent_tests: history.slice(-RECENT_LIMIT),
      history,
    };
  }

  async adminDashboard(actor) {
    const scoped = actor.role === ROLES.SUPER_ADMIN ? {} : { institution_id: actor.institutionId };

    const [{ total: students }, { total: assessments }, { rows: attempts, total: attemptsTotal }, { total: placements }] =
      await Promise.all([
        userRepository.findAll({ page: 1, limit: 1, filters: { ...scoped, role: ROLES.STUDENT } }),
        testRepository.findAll({ page: 1, limit: 1, filters: scoped }),
        assessmentAttemptRepository.findAll({ page: 1, limit: 10000, filters: scoped }),
        placementRecordRepository.findAll({ page: 1, limit: 1, filters: scoped }),
      ]);

    const avgScore = attempts.length
      ? Math.round((attempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / attempts.length) * 100) / 100
      : 0;

    return { students, assessments, attempts: attemptsTotal, placements, avg_score: avgScore };
  }

  async superDashboard() {
    const [students, faculty, admins, recruiters] = await Promise.all([
      userRepository.findAll({ page: 1, limit: 1, filters: { role: ROLES.STUDENT } }),
      userRepository.findAll({ page: 1, limit: 1, filters: { role: ROLES.FACULTY } }),
      userRepository.findAll({ page: 1, limit: 1, filters: { role: ROLES.INSTITUTION_ADMIN } }),
      userRepository.findAll({ page: 1, limit: 1, filters: { role: ROLES.HR } }),
    ]);

    return {
      students: students.total,
      faculty: faculty.total,
      admins: admins.total,
      recruiters: recruiters.total,
    };
  }
}

module.exports = new DashboardService();
