const achievementRepository = require('../repositories/achievement.repository');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const institutionRepository = require('../repositories/institution.repository');
const assessmentAttemptRepository = require('../repositories/assessmentAttempt.repository');
const interviewAttemptRepository = require('../repositories/interviewAttempt.repository');
const placementRecordRepository = require('../repositories/placementRecord.repository');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');

// Fixed thresholds, checked every call to evaluate() — ported verbatim from
// python-service's achievements.py. Idempotent per type (won't double-award)
// but never revokes if a metric later regresses, same as the source: these
// are ratchet counters, not live standings.
const RULES = [
  {
    type: 'practice-5',
    title: 'Practice Starter',
    sourceModule: 'assessments',
    check: async (studentId) => (await assessmentAttemptRepository.countCompletedForStudent(studentId)) >= 5,
  },
  {
    type: 'interview-1',
    title: 'Interview Ready',
    sourceModule: 'interviews',
    check: async (studentId) => (await interviewAttemptRepository.countForStudent(studentId)) >= 1,
  },
  {
    type: 'placed',
    title: 'Placed Talent',
    sourceModule: 'placements',
    check: async (studentId) => (await placementRecordRepository.countForStudent(studentId)) >= 1,
  },
];

class AchievementService {
  async listForStudent(studentId) {
    const { rows } = await achievementRepository.findByStudentId(studentId);
    return rows.sort((a, b) => new Date(b.achieved_at) - new Date(a.achieved_at));
  }

  async evaluate(studentId) {
    const student = await studentRepository.findById(studentId);
    if (!student) throw ApiError.notFound('Student not found');

    for (const rule of RULES) {
      const met = await rule.check(studentId);
      if (!met) continue;
      const existing = await achievementRepository.findByStudentIdAndType(studentId, rule.type);
      if (existing) continue;

      await achievementRepository.create({
        student_id: studentId,
        institution_id: student.institution_id,
        achievement_type: rule.type,
        title: rule.title,
        description: rule.title,
        source_module: rule.sourceModule,
        achieved_at: new Date(),
      });
    }

    return this.listForStudent(studentId);
  }

  // Ported from python-service's GET /leaderboard, including its documented
  // "fake trend" heuristic (score % 3 / % 2, not a real trend calculation) —
  // kept as-is since it's existing product behavior, not a bug, per the
  // Phase 3 migration plan.
  async leaderboard(actor, scope = 'national') {
    const filters = { role: ROLES.STUDENT, status: 'approved' };
    if (scope === 'college' && actor.institutionId) filters.institution_id = actor.institutionId;

    const { rows: users } = await userRepository.findAll({ page: 1, limit: 100, filters });

    const institutionCache = new Map();
    const rows = await Promise.all(
      users.map(async (user) => {
        const student = await studentRepository.findByUserId(user.id);
        const tests = (student && student.tests_completed) || 0;
        const accuracy = (student && student.avg_accuracy) || 0;
        const score = Math.round(tests * accuracy * 10);

        let trend = 'same';
        if (tests > 0) {
          trend = score % 3 === 0 ? 'up' : score % 2 === 0 ? 'down' : 'same';
        }

        let collegeName = 'Independent';
        if (user.institution_id) {
          if (!institutionCache.has(user.institution_id)) {
            const institution = await institutionRepository.findById(user.institution_id);
            institutionCache.set(user.institution_id, institution ? institution.name : 'Independent');
          }
          collegeName = institutionCache.get(user.institution_id);
        }

        return {
          id: user.id,
          name: user.full_name,
          college: collegeName,
          score,
          accuracy,
          avatar: user.full_name ? user.full_name.charAt(0).toUpperCase() : 'U',
          trend,
          rank: 0,
        };
      })
    );

    // A leaderboard is never totally empty just because everyone has 0
    // activity — falls back to the unfiltered set in that case, same as
    // python-service.
    const activeRows = rows.filter((r) => r.score > 0);
    const ranked = (activeRows.length > 0 ? activeRows : rows).sort((a, b) => b.score - a.score);
    ranked.forEach((row, i) => {
      row.rank = i + 1;
    });

    return ranked;
  }
}

module.exports = new AchievementService();
