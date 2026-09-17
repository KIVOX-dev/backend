module.exports = {
  tableName: 'lesson_assessment_attempts',
  columns: [
    'student_id',
    'course_id',
    'lesson_id',
    // Selected option index per question, same order as lessons.assessment_questions.
    'answers',
    'score',
    'max_score',
    'percentage',
  ],
};
