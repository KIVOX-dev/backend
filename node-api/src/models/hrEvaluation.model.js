// One evaluator's scorecard for one application (unique per evaluator).
// scores: [{ name, category: 'skill'|'technical'|'behavioral', rating 1-5, weight, comment }]
module.exports = {
  tableName: 'hr_evaluations',
  columns: [
    'org_id', 'application_id', 'placement_id', 'student_id', 'evaluator_id', 'interview_id',
    'scores', 'score_percent', 'recommendation', 'strengths', 'concerns', 'notes',
  ],
  defaults: { scores: [] },
};
