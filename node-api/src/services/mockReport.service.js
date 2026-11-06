// Placeholder, replaced in the "scoring and final report" step.
async function build(session, rounds) {
  return {
    generated_at: new Date(),
    overall_score: session.overall_score,
    round_scores: session.round_scores,
    rounds: rounds.length,
  };
}

module.exports = { build };
