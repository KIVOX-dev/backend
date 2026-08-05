module.exports = {
  tableName: 'placement_applications',
  // round: which interview/selection round a shortlist applies to (1, 2, 3…).
  // Optional/null for a plain student self-apply — only ever set via the
  // staff shortlist paths (createOnBehalf / bulkShortlist).
  columns: ['placement_id', 'student_id', 'institution_id', 'status', 'round'],
};
