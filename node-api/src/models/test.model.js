module.exports = {
  tableName: 'tests',
  columns: [
    'institution_id', 'created_by', 'title', 'description',
    'test_type', 'duration_minutes', 'total_marks',
    // Ported from python-service's assessments.py:
    'difficulty', 'pass_percentage', 'negative_marking',
    'shuffle_questions', 'shuffle_options', 'show_result_immediately',
    'max_attempts', 'status',
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
