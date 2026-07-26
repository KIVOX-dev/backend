// Ported from python-service's achievements collection (badges awarded by
// the rule engine in achievement.service.js#evaluate).
module.exports = {
  tableName: 'achievements',
  columns: [
    'student_id', 'institution_id', 'achievement_type', 'title',
    'description', 'source_module', 'metric_value', 'achieved_at',
  ],
};
