module.exports = {
  tableName: 'tests',
  columns: [
    'institution_id', 'created_by', 'title', 'description',
    'test_type', 'duration_minutes', 'total_marks',
    // Ported from python-service's assessments.py:
    'difficulty', 'pass_percentage', 'negative_marking',
    'shuffle_questions', 'shuffle_options', 'show_result_immediately',
    'max_attempts', 'status',
    // Set only on the 4 seeded self-serve practice banks (quantitative,
    // logical, verbal, data_interpretation) — null on every regular
    // admin-authored test. See test.service.js#list for how this gates
    // visibility: category != null is open to every student unconditionally,
    // category == null requires a matching test_assignments row.
    'category',
    // Deliberately a *different* field from `category` above — this is which
    // question-bank category an admin-authored graded test draws its random
    // questions from (see testAssignment.service.js#create), not a
    // visibility flag. Reusing `category` here would wrongly make the test
    // universally visible per test.service.js#list's gating.
    'source_category', 'question_count',
    // Scheduling window — drives the Upcoming/Active/Completed status shown
    // on the student's Aptitude Tests card. Null on the practice banks and
    // any test with no window (always "Active").
    'start_at', 'end_at',
  ],
  defaults: {
    test_type: 'mcq',
    pass_percentage: 40,
    negative_marking: false,
    shuffle_questions: true,
    shuffle_options: false,
    show_result_immediately: true,
    max_attempts: 1,
    status: 'active',
  },
};
