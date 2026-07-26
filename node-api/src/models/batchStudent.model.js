// Join row, batch <-> student. python-service's version had no dedup check
// on insert (re-running a batch import with an overlapping roster could
// create duplicate rows for the same pair) — not fixed here, since it's
// harmless (nothing treats this as a unique constraint) and out of scope for
// a straight port; worth a follow-up index (`{batch_id, student_id}` unique)
// if this becomes a real data-quality issue.
module.exports = {
  tableName: 'batch_students',
  columns: ['batch_id', 'student_id'],
};
