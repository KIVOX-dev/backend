const achievementRepository = require('../repositories/achievement.repository');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const institutionRepository = require('../repositories/institution.repository');
const assessmentAttemptRepository = require('../repositories/assessmentAttempt.repository');
const interviewAttemptRepository = require('../repositories/interviewAttempt.repository');
const placementRecordRepository = require('../repositories/placementRecord.repository');
const { ROLES } = require('../config/constants');
const { canActOnStudent } = require('../utils/authz');
const ApiError = require('../utils/ApiError');

// Rows returned by leaderboard() after ranking the full eligible pool —
// keeps the response (and the frontend's un-paginated table) bounded without
// reintroducing the recency-sampling bug a capped fetch caused before.
const LEADERBOARD_DISPLAY_LIMIT = 100;

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
  async listForStudent(studentId, actor) {
    const student = await studentRepository.findById(studentId);
    if (!student) throw ApiError.notFound('Student not found');
    if (!canActOnStudent(actor, student)) throw ApiError.forbidden('Not authorized');

    const { rows } = await achievementRepository.findByStudentId(studentId);
    return rows.sort((a, b) => new Date(b.achieved_at) - new Date(a.achieved_at));
  }

  async evaluate(studentId, actor) {
    const student = await studentRepository.findById(studentId);
    if (!student) throw ApiError.notFound('Student not found');
    if (!canActOnStudent(actor, student)) throw ApiError.forbidden('Not authorized');

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

    return this.listForStudent(studentId, actor);
  }

  // Ported from python-service's GET /leaderboard, including its documented
  // "fake trend" heuristic (score % 3 / % 2, not a real trend calculation) —
  // kept as-is since it's existing product behavior, not a bug, per the
  // Phase 3 migration plan.
  async leaderboard(actor, scope = 'national') {
    const filters = { role: ROLES.STUDENT, status: 'approved' };
    if (scope === 'college' && actor.institutionId) filters.institution_id = actor.institutionId;

    // limit: 0 (MongoDB driver convention for "no limit") — score isn't a
    // stored field, so it can't be sorted in the query itself; ranking only
    // happens after fetching, in JS, below. A capped fetch here (the old
    // limit: 100) sorted by BaseRepository's default `created_at: -1` first,
    // so it silently ranked only the 100 most-recently-created students
    // nationwide rather than the true top scorers — a college that onboarded
    // a large batch together could fill that entire window and crowd out
    // every higher-scoring student everywhere else. The top-N slice below,
    // after sorting by score, is what actually keeps the response bounded.
    const { rows: users } = await userRepository.findAll({ page: 1, limit: 0, filters });

    const institutionCache = new Map();
    const rows = await Promise.all(
      users.map(async (user) => {
        const student = await studentRepository.findByUserId(user.id);
        const tests = (student && student.tests_completed) || 0;
        const accuracy = (student && student.avg_accuracy) || 0;
        // tests * accuracy directly (no inflation multiplier) — a student
        // with a handful of tests reads as a small, honest number instead of
        // a game-score-looking 2,900+.
        const score = Math.round(tests * accuracy);

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
    // Standard competition ranking ("1224"): tied scores share a rank, and
    // the next distinct score's rank skips ahead by the number of ties
    // rather than incrementing by one — otherwise equal scores were getting
    // sequential ranks (and, on the frontend, different 🥇🥈🥉 medals) purely
    // from array order, which misrepresents an actual tie.
    let rank = 0;
    let prevScore = null;
    ranked.forEach((row, i) => {
      if (row.score !== prevScore) {
        rank = i + 1;
        prevScore = row.score;
      }
      row.rank = rank;
    });

    // Rank numbers above are computed over the full pool so they stay
    // accurate; only the response is capped, so a #87 is never mislabeled
    // #1 just because everyone ranked above them got cut off first.
    return ranked.slice(0, LEADERBOARD_DISPLAY_LIMIT);
  }
}

module.exports = new AchievementService();
