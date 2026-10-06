// Candidate pipeline: Applied → Screening → Shortlisted → Interview →
// Selected → Hired → Rejected. `withdrawn` is the student's own exit and sits
// outside the recruiter-driven flow.
const PIPELINE_STAGES = ['applied', 'screening', 'shortlisted', 'interview', 'selected', 'hired', 'rejected'];
const ALL_STATUSES = [...PIPELINE_STAGES, 'withdrawn'];
const TERMINAL = ['hired', 'withdrawn'];

// Ordinal of the forward stages — used to answer "did this candidate ever
// reach stage X" in analytics. rejected/withdrawn have no position.
const STAGE_ORDER = { applied: 0, screening: 1, shortlisted: 2, interview: 3, selected: 4, hired: 5 };

// Timestamp column stamped on first entry into a stage.
const STAGE_TIMESTAMP = {
  screening: 'screened_at', shortlisted: 'shortlisted_at', interview: 'interview_at',
  selected: 'selected_at', hired: 'hired_at', rejected: 'rejected_at',
};

const SOURCES = ['direct_application', 'campus_shortlist', 'talent_pool', 'recruiter_invite'];

// Highest forward stage this application ever reached, from its history plus
// its current status (legacy rows predate stage_history).
function highestStageReached(application) {
  let best = STAGE_ORDER[application.status] ?? 0;
  for (const h of application.stage_history || []) {
    const o = STAGE_ORDER[h.to];
    if (o !== undefined && o > best) best = o;
  }
  return best;
}

module.exports = { PIPELINE_STAGES, ALL_STATUSES, TERMINAL, STAGE_ORDER, STAGE_TIMESTAMP, SOURCES, highestStageReached };
