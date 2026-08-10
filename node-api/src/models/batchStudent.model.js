// Join row, batch <-> student. `student_id` is the `students` collection's
// own row id (not `users._id`) — same convention every other *_id field
// named "student_id" in this codebase follows (see batch.service.js#create,
// fixed in the same pass this comment was corrected in). Deduplication on
// insert is enforced at the database level by the {batch_id, student_id}
// unique index in scripts/setupIndexes.js, not application code.
module.exports = {
  tableName: 'batch_students',
  columns: ['batch_id', 'student_id'],
};
