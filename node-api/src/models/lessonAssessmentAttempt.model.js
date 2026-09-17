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
    // Client-reported integrity signals from the proctored assessment window
    // (AssessmentWindow.tsx) — tab switches away from the window, copy/paste/cut
    // attempts, and the screen-share stream ending early. Self-reported by the
    // browser, not independently verified server-side (no recording is
    // captured/stored) — a soft signal for the student's own review, not proof.
    'violations',
  ],
};
