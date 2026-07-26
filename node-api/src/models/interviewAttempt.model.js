// Ported from python-service's interview_attempts collection (students.py's
// interview-logging endpoints). The standalone AI-generated mock-interview
// question flow (python's interviews.py `/interviews/generate`, Groq-backed)
// is deferred to the AI-features migration checkpoint — this covers only
// recording a completed attempt, which needs no AI dependency.
module.exports = {
  tableName: 'interview_attempts',
  columns: [
    'student_id', 'institution_id', 'role', 'category', 'overall_rating',
    'strengths', 'improvements', 'duration_seconds', 'attempt_number', 'status',
  ],
  defaults: { status: 'completed' },
};
