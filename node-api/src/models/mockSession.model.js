// One mock-interview attempt (3 rounds: MCQ -> Group Discussion -> HR). Never overwritten:
// every attempt is a new document, so history and trends are preserved.
// Per-round payloads live in `mock_round_results`; the consolidated report lives here.
module.exports = {
  tableName: 'mock_sessions',
  columns: [
    'student_id', 'user_id', 'institution_id', 'department_id', 'batch_id',
    'role', 'company', 'status', 'current_round', 'completed_rounds',
    'started_at', 'completed_at', 'last_activity_at',
    'round_scores', 'overall_score', 'final_report', 'pdf_path',
  ],
  defaults: { status: 'in_progress', current_round: 1, completed_rounds: [], round_scores: {} },
};
