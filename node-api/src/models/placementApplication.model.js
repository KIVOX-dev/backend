module.exports = {
  tableName: 'placement_applications',
  // round: which interview/selection round a shortlist applies to (1, 2, 3…).
  // Optional/null for a plain student self-apply — only ever set via the
  // staff shortlist paths (createOnBehalf / bulkShortlist).
  //
  // HR pipeline fields: stage_history is an append-only log of
  // { from, to, at, by, note }; source says how the candidate arrived
  // (direct_application | campus_shortlist | talent_pool | recruiter_invite);
  // recruiter_id denormalises the placement's owner for fast HR scoping;
  // match_score/match_details cache the resume-vs-JD match; overall_score is
  // the composite (evaluation + interview + match) used for ranking.
  columns: [
    'placement_id', 'student_id', 'institution_id', 'status', 'round',
    'stage_history', 'source', 'recruiter_id', 'notes', 'rejection_reason',
    'match_score', 'match_details', 'overall_score',
    'screened_at', 'shortlisted_at', 'interview_at', 'selected_at', 'hired_at', 'rejected_at',
  ],
  defaults: { stage_history: [] },
};
