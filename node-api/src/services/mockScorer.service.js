// Round 2 / Round 3 scoring. Heuristics always run (deterministic, free); an LLM refinement via
// ai-service is layered on in a later step and must never block or fail a submission.
const scoring = require('../utils/mockScoring');
const { referencesOther } = require('../utils/gdEngine');

async function scoreGd(payload) {
  // Don't trust the client for 'built on another participant's point': detect it from the text.
  const turns = payload.turns.map((t) => (t.is_student ? { ...t, references_other: t.references_other || referencesOther(t.text) } : t));
  const metrics = scoring.computeGdMetrics(turns);
  const parameter_scores = scoring.heuristicGdScores(turns, metrics);
  return {
    overall_score: scoring.avgParams(parameter_scores),
    parameter_scores,
    payload: {
      topic: payload.topic,
      category: payload.category,
      difficulty: payload.difficulty,
      duration_seconds: payload.duration_seconds,
      metrics,
      transcript: turns,
    },
  };
}

async function scoreHr(payload) {
  const parameter_scores = scoring.heuristicHrScores(payload.pairs);
  const pairs = payload.pairs.map((p) => {
    const score = scoring.avgParams(scoring.heuristicHrScores([p]));
    let note = 'Answer was missing or too brief.';
    if (score >= 7) note = 'Clear, relevant answer.';
    else if (score >= 4) note = 'Add more detail and a concrete example.';
    return { ...p, score, note };
  });
  return {
    overall_score: scoring.avgParams(parameter_scores),
    parameter_scores,
    payload: { duration_seconds: payload.duration_seconds, pairs },
  };
}

module.exports = { scoreGd, scoreHr };
