// Turn-taking logic for the group discussion. Pure functions (injectable clock/rng) so the
// "bots never all talk at once" rules are unit-testable. The browser only plays what this says.
//
// Slot order matches tts.service BOT_PROFILES: 0 Dominator, 1 Fact Quoter, 2 Drifter, 3 Mediator.
const BOTS = [
  { slot: 'bot0', id: 'dominator', name: 'Kiran', personality: 'dominator' },
  { slot: 'bot1', id: 'fact_quoter', name: 'Deep', personality: 'fact_quoter' },
  { slot: 'bot2', id: 'drifter', name: 'Sasi', personality: 'drifter' },
  { slot: 'bot3', id: 'mediator', name: 'Ari', personality: 'mediator' },
];
const MEDIATOR = BOTS[3];

const T = Object.freeze({
  OPEN_GRACE_MS: 15000, //      let the student open before the moderator does
  NUDGE_MS: 25000, //           student silent this long -> moderator invites them
  MAX_BOT_STREAK: 2, //         bots never chain more than 2 turns without the student
  CLOSING_WINDOW_MS: 60000, //  last minute is the closing summary
  INTERRUPT_AFTER_MS: 20000, // Dominator may cut in only after the student talked this long
  INTERRUPT_COOLDOWN_MS: 90000,
  INTERRUPT_CHANCE: 0.35,
});

const botByName = (name) => BOTS.find((b) => b.name === name || b.id === name);
const isBotTurn = (t) => !t.is_student;

function trailingBotStreak(turns) {
  let n = 0;
  for (let i = turns.length - 1; i >= 0 && isBotTurn(turns[i]); i -= 1) n += 1;
  return n;
}

// Weighted pick that excludes the last speaker, with each personality favoured at the moments it
// naturally speaks (Mediator after a long student turn, Fact Quoter after a claim, etc).
function chooseBot(turns, rng) {
  const lastBot = [...turns].reverse().find(isBotTurn);
  const last = turns[turns.length - 1];
  const longStudentTurn = last && last.is_student && (last.duration_ms || 0) > 25000;
  const weights = BOTS.map((b) => {
    if (lastBot && lastBot.speaker === b.name && last && !last.is_student) return 0; // never twice in a row
    let w = 1;
    if (b.id === 'mediator') w = longStudentTurn ? 3 : 0.6;
    if (b.id === 'dominator') w = 1.2;
    if (b.id === 'fact_quoter') w = 1.1;
    const spoke = turns.slice(-8).filter((t) => t.speaker === b.name).length;
    return w / (1 + spoke * 0.5); // balance airtime across bots
  });
  const total = weights.reduce((a, c) => a + c, 0);
  let r = rng() * total;
  for (let i = 0; i < BOTS.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return BOTS[i];
  }
  return BOTS.find((_, i) => weights[i] > 0) || BOTS[0];
}

// Decides what happens next. Returns { action: 'wait' } or
// { action: 'speak', bot, phase, interrupting, invite }.
function planNext({ turns, elapsedMs, totalMs, studentSilentMs, studentName = 'you', closingDone = false }, rng = Math.random) {
  const closing = elapsedMs >= totalMs - T.CLOSING_WINDOW_MS;
  if (closing) {
    if (closingDone) return { action: 'wait', reason: 'closing_in_progress' };
    return { action: 'speak', bot: MEDIATOR, phase: 'closing', interrupting: false, invite: studentName };
  }
  if (turns.length === 0) {
    if (studentSilentMs < T.OPEN_GRACE_MS) return { action: 'wait', reason: 'student_may_open' };
    return { action: 'speak', bot: MEDIATOR, phase: 'opening', interrupting: false, invite: studentName };
  }
  const last = turns[turns.length - 1];
  if (!last.is_student && studentSilentMs >= T.NUDGE_MS) {
    const nudgedRecently = turns.slice(-3).some((t) => t.speaker === MEDIATOR.name && t.phase === 'nudge');
    if (!nudgedRecently) return { action: 'speak', bot: MEDIATOR, phase: 'nudge', interrupting: false, invite: studentName };
  }
  if (trailingBotStreak(turns) >= T.MAX_BOT_STREAK) return { action: 'wait', reason: 'student_turn' };
  return { action: 'speak', bot: chooseBot(turns, rng), phase: 'discussion', interrupting: false, invite: '' };
}

// Called while the student is mid-speech. Only the Dominator ever interrupts, rarely.
function shouldInterrupt({ studentSpeakingMs, msSinceLastInterrupt = Infinity }, rng = Math.random) {
  if (studentSpeakingMs < T.INTERRUPT_AFTER_MS) return null;
  if (msSinceLastInterrupt < T.INTERRUPT_COOLDOWN_MS) return null;
  return rng() < T.INTERRUPT_CHANCE ? BOTS[0] : null;
}

// Did the student build on / refer to someone else's point? Name mention or a reference phrase.
const REF_PHRASES = /\b(as (?:\w+ )?(?:said|mentioned|pointed out)|building on|i (?:agree|disagree) with|to add to|following up on|like (?:\w+ )?said|what (?:\w+ )?(?:said|mentioned))\b/i;
function referencesOther(text) {
  const t = String(text || '');
  return BOTS.some((b) => new RegExp(`\\b${b.name}\\b`, 'i').test(t)) || REF_PHRASES.test(t);
}

module.exports = { BOTS, MEDIATOR, T, botByName, planNext, shouldInterrupt, referencesOther, trailingBotStreak };
