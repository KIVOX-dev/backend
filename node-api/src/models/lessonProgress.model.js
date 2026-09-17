module.exports = {
  tableName: 'lesson_progress',
  columns: ['student_id', 'course_id', 'lesson_id', 'status', 'watched_seconds', 'completed_at'],
  // 'not_started' | 'in_progress' | 'completed' — same string-enum-with-
  // default convention as assessment_attempts/test_assignments, not a bare
  // boolean, so a future "in_progress" distinction (partial watch) doesn't
  // need a schema change.
  defaults: { status: 'not_started', watched_seconds: 0 },
};
