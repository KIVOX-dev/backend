module.exports = {
  tableName: 'students',
  columns: [
    'user_id', 'institution_id', 'department_id', 'roll_number',
    'batch_year', 'cgpa', 'resume_url',
    // Ported from python-service's student_profiles collection:
    'placement_status', 'tests_completed', 'avg_accuracy', 'streak_days',
    'interviews_completed', 'last_test_date',
    // Self-service profile completion (College -> Department flow).
    // `year_of_study` (1-4, "which year of the program") is deliberately
    // NOT the same field as `batch_year` above (a calendar year, e.g. 2024,
    // used by the admin-provisioned/batch-import flows) — conflating them
    // would silently redefine batch_year's existing meaning everywhere else
    // it's used.
    'year_of_study', 'semester', 'section', 'phone', 'date_of_birth',
    'gender', 'address', 'profile_completed',
  ],
  defaults: { profile_completed: false },
};
