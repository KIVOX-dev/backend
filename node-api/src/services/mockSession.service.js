const mockSessionRepository = require('../repositories/mockSession.repository');
const mockRoundResultRepository = require('../repositories/mockRoundResult.repository');
const studentRepository = require('../repositories/student.repository');
const batchStudentRepository = require('../repositories/batchStudent.repository');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const scoring = require('../utils/mockScoring');
const scorer = require('./mockScorer.service');
const reportService = require('./mockReport.service');

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const ROUND_TYPES = { 1: 'mcq', 2: 'group_discussion', 3: 'hr' };

// Backend access control for every mock-session read. Students: own data only.
// institution_admin: own institution only. super_admin: all. Anyone else: denied.
function assertCanRead(actor, session) {
  if (actor.role === ROLES.SUPER_ADMIN) return;
  if (actor.role === ROLES.STUDENT) {
    if (session.user_id !== actor.id) throw ApiError.forbidden('Not authorized');
    return;
  }
  if (actor.role === ROLES.INSTITUTION_ADMIN) {
    if (session.institution_id !== actor.institutionId) throw ApiError.forbidden('Not authorized');
    return;
  }
  throw ApiError.forbidden('Not authorized');
}

function assertOwner(actor, session) {
  if (actor.role !== ROLES.STUDENT || session.user_id !== actor.id) throw ApiError.forbidden('Not authorized');
}

async function load(id) {
  const session = await mockSessionRepository.findById(id);
  if (!session) throw ApiError.notFound('Session not found');
  return session;
}

// Round results are visible as soon as the round ends; the consolidated report only once the
// whole attempt is completed.
function present(session, rounds) {
  return { ...session, rounds, final_report: session.status === 'completed' ? session.final_report || null : null };
}

class MockSessionService {
  async create(data, actor) {
    if (actor.role !== ROLES.STUDENT) throw ApiError.forbidden('Only students can start a mock interview');
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.notFound('Student profile not found');
    const link = await batchStudentRepository.collection.findOne({ student_id: student.id });
    const now = new Date();
    return mockSessionRepository.create({
      student_id: student.id,
      user_id: actor.id,
      institution_id: student.institution_id,
      department_id: student.department_id || null,
      batch_id: link ? link.batch_id : null,
      role: data.role,
      company: data.company,
      started_at: now,
      last_activity_at: now,
    });
  }

  async listOwn(actor) {
    if (actor.role !== ROLES.STUDENT) throw ApiError.forbidden('Not authorized');
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) return [];
    await mockSessionRepository.markStaleIncomplete(student.id, new Date(Date.now() - STALE_AFTER_MS));
    const sessions = await mockSessionRepository.listForStudent(student.id);
    return sessions.map(({ final_report, ...rest }) => rest);
  }

  async get(id, actor) {
    const session = await load(id);
    assertCanRead(actor, session);
    const rounds = await mockRoundResultRepository.listForSession(session.id);
    return present(session, rounds);
  }

  // Strict order, no gating: round N is accepted whatever round N-1 scored.
  async submitRound(id, round, payload, actor) {
    const session = await load(id);
    assertOwner(actor, session);
    if (session.status !== 'in_progress') throw ApiError.badRequest(`Session is ${session.status}`);
    if (round !== session.current_round) throw ApiError.badRequest(`Round ${session.current_round} is next`);

    let scored;
    if (round === 1) scored = scoring.scoreMcq(payload.items);
    else if (round === 2) scored = await scorer.scoreGd(payload, session);
    else scored = await scorer.scoreHr(payload, session);

    const result = await mockRoundResultRepository.create({
      session_id: session.id,
      student_id: session.student_id,
      institution_id: session.institution_id,
      round,
      round_type: ROUND_TYPES[round],
      overall_score: scored.overall_score,
      parameter_scores: scored.parameter_scores,
      payload: scored.payload,
      completed_at: new Date(),
    });

    const round_scores = { ...session.round_scores, [round]: scored.overall_score };
    const patch = {
      round_scores,
      completed_rounds: [...session.completed_rounds, round],
      current_round: Math.min(round + 1, 3),
      last_activity_at: new Date(),
    };
    if (round === 3) {
      patch.status = 'completed';
      patch.completed_at = new Date();
      patch.overall_score = scoring.overallScore(round_scores);
    }
    let updated = await mockSessionRepository.updateById(session.id, patch);
    if (round === 3) {
      const rounds = await mockRoundResultRepository.listForSession(session.id);
      const final_report = await reportService.build(updated, rounds);
      updated = await mockSessionRepository.updateById(session.id, { final_report });
    }
    return { round: result, session: present(updated, undefined) };
  }

  // Quitting midway keeps whatever rounds finished; no report is generated.
  async abandon(id, actor) {
    const session = await load(id);
    assertOwner(actor, session);
    if (session.status !== 'in_progress') return session;
    return mockSessionRepository.updateById(id, { status: 'incomplete', last_activity_at: new Date() });
  }
}

module.exports = new MockSessionService();
module.exports.assertCanRead = assertCanRead;
