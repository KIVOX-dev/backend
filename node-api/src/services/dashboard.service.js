const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const testRepository = require('../repositories/test.repository');
const assessmentAttemptRepository = require('../repositories/assessmentAttempt.repository');
const interviewAttemptRepository = require('../repositories/interviewAttempt.repository');
const placementRecordRepository = require('../repositories/placementRecord.repository');
const { ROLES } = require('../config/constants');
const { canActOnStudent } = require('../utils/authz');
const ApiError = require('../utils/ApiError');
const { CATEGORY_META } = require('../config/aptitudeCategories');

const RECENT_LIMIT = 5;
const HISTORY_LIMIT = 100;

function average(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

// A resolvable category comes from either of two different columns on the
// tests collection depending on how the test was taken: `category` is set
// only on the 4 open self-serve practice banks; `source_category` is set on
// an admin-authored assigned test instead, recording which of the same 4
// question banks it drew its questions from (see test.model.js). A given
// attempt's test has exactly one of the two set, never both.
function resolveCategory(test) {
  return test?.category || test?.source_category || null;
}

// Rule-based, ~60 words, third person (an admin reading this about a
// student they're looking up, not the student themself) — same
// real-numbers-only philosophy as studentProfile.service.js's focus_areas,
// just condensed into one encouraging paragraph instead of a checklist.
function buildFocusMessage({ name, testsCompleted, interviewsCompleted, attemptedStats }) {
  if (testsCompleted === 0) {
    return `${name} hasn't attempted any aptitude tests yet. Starting with a few practice sessions across Quantitative Aptitude, Logical Reasoning, Verbal Ability, and Data Interpretation will build a strong baseline fast. Once a clear pattern shows up, focused practice on the weakest area tends to turn into rapid, visible improvement — every attempt from here adds real signal to their placement readiness.`;
  }

  const sorted = [...attemptedStats].sort((a, b) => b.avg_percentage - a.avg_percentage);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const interviewNote = interviewsCompleted === 0
    ? `Layering in a mock interview next would round out a solid aptitude foundation with real interview-day confidence.`
    : `Keeping up mock interview practice alongside this will carry the momentum straight through to placement readiness.`;

  if (!weakest || weakest.avg_percentage >= 70) {
    return `${name} is performing consistently well across every aptitude category attempted, averaging strong, stable scores over ${testsCompleted} completed test${testsCompleted === 1 ? '' : 's'}. ${strongest ? `${strongest.label} stands out at ${strongest.avg_percentage}% average — a genuine strength worth highlighting on their profile.` : ''} ${interviewNote} That kind of consistency is exactly what recruiters look for in a placement-ready candidate.`;
  }

  return `${name} is performing strongly in ${strongest.label} (${strongest.avg_percentage}% average) — a real strength worth leaning into. Focusing next on ${weakest.label} (${weakest.avg_percentage}% average) with a few more practice sessions will round out their profile fast. With ${testsCompleted} test${testsCompleted === 1 ? '' : 's'} already completed, they're building solid momentum. ${interviewNote}`;
}

class DashboardService {
  // Distinct from student.service.js#dashboard (students.py's own dashboard
  // endpoint, which reads cached stats off the students row) — this mirrors
  // dashboard.py's version, computed fresh via aggregation over attempts.
  //
  // `actor` is required and checked with the same canActOnStudent() gate
  // every other per-student endpoint in student.service.js already uses —
  // this endpoint used to skip it entirely (any authenticated user, any
  // role, any institution, could read any student's stats by id). Both
  // current callers (StudentTracking.tsx, CollegeAdminDashboard.tsx) already
  // pass the students-collection id, matching what findById expects here.
  async studentDashboard(studentId, actor) {
    const student = await studentRepository.findById(studentId);
    if (!student) throw ApiError.notFound('Student not found');
    if (!canActOnStudent(actor, student)) throw ApiError.forbidden('Not authorized');

    const [stats, history, interviewsCompleted, placements, user] = await Promise.all([
      assessmentAttemptRepository.aggregateStatsForStudent(studentId),
      assessmentAttemptRepository.recentForStudent(studentId, HISTORY_LIMIT),
      interviewAttemptRepository.countForStudent(studentId),
      placementRecordRepository.countForStudent(studentId),
      userRepository.findById(student.user_id),
    ]);

    // Same 4-category breakdown as studentProfile.service.js's Practice
    // Module trend charts, but for an admin looking up any student by id —
    // resolveCategory() also covers admin-assigned tests (source_category),
    // not just the open practice banks (category), since an admin-viewed
    // student's history is realistically mostly assigned tests.
    const completedAttempts = history.filter((a) => a.status === 'completed');
    const testIds = [...new Set(completedAttempts.map((a) => a.test_id))];
    const tests = await testRepository.findByIds(testIds);
    const categoryByTestId = new Map(tests.map((t) => [t.id, resolveCategory(t)]));

    const byCategory = new Map(Object.keys(CATEGORY_META).map((key) => [key, []]));
    for (const attempt of completedAttempts) {
      const category = categoryByTestId.get(attempt.test_id);
      if (!category || !byCategory.has(category) || !attempt.completed_at) continue;
      byCategory.get(category).push({ date: attempt.completed_at, percentage: Math.round(attempt.percentage || 0) });
    }

    const categoryTrends = Object.entries(CATEGORY_META).map(([category, meta]) => ({
      category,
      label: meta.label,
      points: byCategory.get(category).sort((a, b) => new Date(a.date) - new Date(b.date)),
    }));

    const attemptedStats = categoryTrends
      .filter((c) => c.points.length > 0)
      .map((c) => ({
        category: c.category,
        label: c.label,
        avg_percentage: Math.round(average(c.points.map((p) => p.percentage))),
        attempts: c.points.length,
      }));

    const focusMessage = buildFocusMessage({
      name: user?.full_name || 'This student',
      testsCompleted: stats.tests_completed,
      interviewsCompleted,
      attemptedStats,
    });

    return {
      tests_completed: stats.tests_completed,
      avg_accuracy: stats.avg_accuracy,
      interviews_completed: interviewsCompleted,
      placements,
      recent_tests: history.slice(-RECENT_LIMIT),
      history,
      category_trends: categoryTrends,
      focus_message: focusMessage,
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
