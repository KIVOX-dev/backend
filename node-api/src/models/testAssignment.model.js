module.exports = {
  tableName: 'test_assignments',
  columns: ['test_id', 'student_id', 'assigned_by', 'scheduled_at', 'status'],
  defaults: { status: 'assigned' },
};
