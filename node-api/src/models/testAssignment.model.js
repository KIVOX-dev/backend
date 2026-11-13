module.exports = {
  tableName: 'test_assignments',
  columns: [
    'test_id', 'student_id', 'institution_id', 'assigned_by', 'scheduled_at', 'status',
    // The specific random draw (subset + order) of question-bank ids this
    // student got for this assignment — populated once at assignment-create
    // time (see testAssignment.service.js#create). Distinct per student
    // even for the same test, which is what "different pattern" per student
    // actually means. Empty on any test with no `source_category`.
    'question_ids',
    // Server-side exam session (see utils/examClock.js): when the student
    // actually began, their autosaved answers, the last time we heard from
    // their client, and every recorded connection-loss pause (for admin review).
    'started_at', 'saved_answers', 'saved_at', 'last_heartbeat_at', 'pauses',
  ],
  defaults: { status: 'assigned' },
};
