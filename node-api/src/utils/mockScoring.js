// Pure scoring helpers for the 3-round mock interview. Scores are always 0-10 per parameter and
// are informational only: nothing here gates, unlocks, or labels pass/fail.
const ROUND_WEIGHTS = Object.freeze({ 1: 0.25, 2: 0.35, 3: 0.4 });
const GD_PARAMS = ['content_relevance', 'communication_clarity', 'initiative', 'listening_building', 'leadership_collaboration', 'time_management_conclusion'];
const HR_PARAMS = ['content_quality', 'communication_confidence', 'answer_structure', 'relevance', 'professionalism', 'self_awareness'];
const FILLERS = ['um', 'uh', 'erm', 'like', 'you know', 'basically', 'actually', 'i mean', 'sort of', 'kind of'];

const clamp10 = (n) => Math.max(0, Math.min(10, Math.round(Number(n) * 10) / 10 || 0));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const words = (t) => (String(t || '').toLowerCase().match(/[a-z0-9']+/g) || []);

function countFillers(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z' ]/g, ' ')} `;
  return FILLERS.reduce((n, f) => n + (t.split(` ${f} `).length - 1), 0);
}

// Round 1: client sends each question with the student's selected option; the correct answer
// comes from the question set that was shown. Score = accuracy scaled to 10.
function scoreMcq(items) {
  const review = items.map((q) => ({
    question: q.question,
    section: q.section || 'General',
    options: q.options || [],
    selected: q.selected ?? null,
    correct_answer: q.correct_answer,
    is_correct: q.selected != null && q.selected === q.correct_answer,
    explanation: q.explanation || '',
  }));
  const correct = review.filter((r) => r.is_correct).length;
  const topics = {};
  for (const r of review) {
    const t = (topics[r.section] ||= { section: r.section, correct: 0, total: 0 });
    t.total += 1;
    if (r.is_correct) t.correct += 1;
  }
  const topic_scores = Object.values(topics).map((t) => ({ ...t, score: clamp10((t.correct / t.total) * 10) }));
  const accuracy = review.length ? correct / review.length : 0;
  return {
    overall_score: clamp10(accuracy * 10),
    parameter_scores: { accuracy: clamp10(accuracy * 10) },
    payload: { total: review.length, correct, topic_scores, review },
  };
}

// Round 2 metrics derived from the stored transcript. Turns: {speaker, is_student, text, at_ms,
// duration_ms, interrupted_by?, interrupts?, references_other?}.
function computeGdMetrics(turns, { openedBy, concludedBy } = {}) {
  const spoken = turns.reduce((s, t) => s + (t.duration_ms || 0), 0);
  const mine = turns.filter((t) => t.is_student);
  const myMs = mine.reduce((s, t) => s + (t.duration_ms || 0), 0);
  const firstSpeaker = openedBy ?? (turns[0] && turns[0].is_student);
  const last = turns[turns.length - 1];
  return {
    speaking_time_share: spoken ? Math.round((myMs / spoken) * 1000) / 10 : 0,
    student_turns: mine.length,
    interruptions_made: mine.filter((t) => t.interrupts).length,
    interruptions_received: turns.filter((t) => !t.is_student && t.interrupts && t.interrupted_student).length,
    references_to_others: mine.filter((t) => t.references_other).length,
    filler_words: mine.reduce((s, t) => s + countFillers(t.text), 0),
    opened_discussion: Boolean(firstSpeaker),
    concluded_discussion: Boolean(concludedBy ?? (last && last.is_student && last.phase === 'closing')),
  };
}

// Heuristic GD scorer (used when the LLM scorer is unavailable and as a floor for it).
function heuristicGdScores(turns, metrics) {
  const text = turns.filter((t) => t.is_student).map((t) => t.text).join(' ');
  const wc = words(text).length;
  const fillerRate = wc ? metrics.filler_words / wc : 0;
  const share = metrics.speaking_time_share;
  const shareScore = share >= 15 && share <= 35 ? 10 : share < 15 ? (share / 15) * 10 : Math.max(4, 10 - (share - 35) / 6);
  return {
    content_relevance: clamp10(Math.min(wc / 12, 10) * 0.8 + 1),
    communication_clarity: clamp10(10 - fillerRate * 60),
    initiative: clamp10(2 + (metrics.opened_discussion ? 3 : 0) + Math.min(metrics.student_turns, 5)),
    listening_building: clamp10(1 + Math.min(metrics.references_to_others * 2.5, 9)),
    leadership_collaboration: clamp10(shareScore * 0.7 + Math.min(metrics.references_to_others, 3)),
    time_management_conclusion: clamp10(3 + (metrics.concluded_discussion ? 5 : 0) + (shareScore > 6 ? 2 : 0)),
  };
}

function heuristicHrScores(pairs) {
  const answered = pairs.filter((p) => words(p.answer).length > 0);
  const avgWords = mean(answered.map((p) => words(p.answer).length));
  const fillers = answered.reduce((s, p) => s + countFillers(p.answer), 0);
  const totalWords = answered.reduce((s, p) => s + words(p.answer).length, 0) || 1;
  const coverage = pairs.length ? answered.length / pairs.length : 0;
  const structured = answered.filter((p) => /\b(situation|task|action|result|because|for example|as a result|so that)\b/i.test(p.answer)).length;
  const length = clamp10(Math.min(avgWords / 8, 10));
  return {
    content_quality: clamp10(length * 0.7 + coverage * 3),
    communication_confidence: clamp10(9 - (fillers / totalWords) * 50 - (1 - coverage) * 4),
    answer_structure: clamp10(2 + (answered.length ? (structured / answered.length) * 7 : 0)),
    relevance: clamp10(coverage * 8 + (avgWords > 15 ? 2 : 0)),
    professionalism: clamp10(coverage ? 7 + (fillers / totalWords < 0.03 ? 2 : 0) : 0),
    self_awareness: clamp10(answered.some((p) => /\b(weakness|improv|learn|mistake|working on)\b/i.test(p.answer)) ? 7 : 4),
  };
}

const avgParams = (p) => clamp10(mean(Object.values(p)));

// Combines available round scores using the weights, renormalised over the rounds present.
function overallScore(roundScores) {
  let num = 0;
  let den = 0;
  for (const [r, s] of Object.entries(roundScores || {})) {
    if (typeof s !== 'number') continue;
    num += s * ROUND_WEIGHTS[r];
    den += ROUND_WEIGHTS[r];
  }
  return den ? clamp10(num / den) : 0;
}

module.exports = {
  ROUND_WEIGHTS, GD_PARAMS, HR_PARAMS, clamp10, countFillers,
  scoreMcq, computeGdMetrics, heuristicGdScores, heuristicHrScores, avgParams, overallScore,
};
