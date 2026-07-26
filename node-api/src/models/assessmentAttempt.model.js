// Ported from python-service's assessment_attempts collection. Deliberately
// separate from node-api's existing `results` (tied to a pre-existing
// test_assignment — a faculty-assigned, formal workflow) — this is a
// student self-submitted attempt against a test, no prior assignment
// required, matching python's actual (and currently live) behavior.
module.exports = {
  tableName: 'assessment_attempts',
  columns: [
    'test_id', 'student_id', 'institution_id', 'attempt_number',
    'score', 'max_score', 'percentage', 'time_taken_seconds', 'passed',
    'status', 'section_scores', 'weak_areas', 'completed_at',
  ],
  defaults: { status: 'completed' },
};
