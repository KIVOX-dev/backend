// Result of one round of a mock session. `round` is 1 (MCQ), 2 (GD) or 3 (HR).
// `payload` is round-specific: MCQ review items, GD transcript + metrics, HR Q/A pairs.
module.exports = {
  tableName: 'mock_round_results',
  columns: [
    'session_id', 'student_id', 'institution_id', 'round', 'round_type',
    'overall_score', 'parameter_scores', 'payload', 'completed_at',
  ],
};
