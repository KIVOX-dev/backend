const mockSessionRepository = require('../repositories/mockSession.repository');
const aiClient = require('../utils/aiServiceClient');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const engine = require('../utils/gdEngine');
const { pickTopic, TOPICS } = require('../config/gdTopics');

const TOTAL_MS = 14 * 60 * 1000; // discussion window (10-15 min); closing summary is the last minute

// Local last-resort line if ai-service is unreachable, so the discussion never stalls.
const LOCAL_FALLBACK = {
  opening: (topic) => `Let us begin. Today's topic is: ${topic} Who would like to start?`,
  nudge: (_t, invite) => `${invite}, we would love to hear your view. What do you think?`,
  closing: () => 'We are almost out of time. Please give your closing summary now.',
  discussion: (topic) => `That is an interesting point. Let us look at another angle on ${topic}`,
};

async function loadOwnedRound2Session(id, actor) {
  const session = await mockSessionRepository.findById(id);
  if (!session) throw ApiError.notFound('Session not found');
  if (actor.role !== ROLES.STUDENT || session.user_id !== actor.id) throw ApiError.forbidden('Not authorized');
  if (session.status !== 'in_progress' || session.current_round !== 2) {
    throw ApiError.badRequest('Group discussion is not the active round');
  }
  return session;
}

function listTopics(query, rng) {
  // Express 5: req.query is read-only, so Joi's boolean coercion never lands; parse it here.
  if (query.random === true || query.random === 'true') return { topic: pickTopic(query, rng) };
  return { topics: TOPICS.filter((t) => (!query.category || t.category === query.category) && (!query.difficulty || t.difficulty === query.difficulty)) };
}

// Asks ai-service for the bot's line; never throws, so a discussion can't stall on an outage.
async function generateLine(plan, body) {
  try {
    const res = await aiClient.callAiService('/v1/gd/turn', {
      topic: body.topic,
      bot_name: plan.bot.name,
      personality: plan.bot.personality,
      phase: plan.phase,
      transcript: body.turns.slice(-12).map((t) => ({ speaker: t.speaker, text: t.text.slice(0, 600) })),
      invite: plan.invite,
      interrupting: plan.interrupting,
    });
    return { text: res.text, source: res.source };
  } catch (err) {
    logger.warn('GD turn: ai-service unavailable, using local line', { error: err.message });
    return { text: LOCAL_FALLBACK[plan.phase](body.topic, plan.invite), source: 'fallback' };
  }
}

// Decides who speaks next (engine) and has ai-service write the line. The browser just plays it.
async function nextTurn(id, body, actor, rng = Math.random) {
  await loadOwnedRound2Session(id, actor);
  const plan = engine.planNext(
    {
      turns: body.turns,
      elapsedMs: body.elapsed_ms,
      totalMs: TOTAL_MS,
      studentSilentMs: body.student_silent_ms,
      studentName: body.student_name,
      closingDone: body.closing_done,
    },
    rng
  );
  if (plan.action === 'wait') return plan;

  const { text, source } = await generateLine(plan, body);
  return { action: 'speak', bot: plan.bot, phase: plan.phase, interrupting: plan.interrupting, text, source };
}

// Browser reports the student has been talking this long. May return the Dominator cutting in,
// with the line already generated so the browser can play it immediately.
async function interruptCheck(id, body, actor, rng = Math.random) {
  await loadOwnedRound2Session(id, actor);
  const bot = engine.shouldInterrupt(
    { studentSpeakingMs: body.student_speaking_ms, msSinceLastInterrupt: body.ms_since_last_interrupt },
    rng
  );
  if (!bot) return { interrupt: false };
  const plan = { bot, phase: 'discussion', interrupting: true, invite: '' };
  const { text, source } = await generateLine(plan, body);
  return { interrupt: true, bot, phase: 'discussion', text, source };
}

module.exports = { listTopics, nextTurn, interruptCheck, TOTAL_MS };
