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
  ],
  defaults: { status: 'assigned' },
};
