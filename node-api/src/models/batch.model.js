module.exports = {
  tableName: 'batches',
  columns: ['name', 'batch_code', 'institution_id', 'faculty_id', 'department', 'year', 'status'],
  defaults: { status: 'active' },
};
