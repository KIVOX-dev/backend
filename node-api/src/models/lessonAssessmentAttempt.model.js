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
    // attempts, the screen-share stream ending early, and a phone/laptop/tv/
    // remote spotted in the camera via real-time MediaPipe object detection
    // (device_detected — that one always ends the assessment on the spot).
    // Self-reported by the browser, not independently verified server-side
    // (no recording is captured/stored) — a soft signal, not proof.
    'violations',
    // 'completed' | 'malpractice' — set server-side in
    // course.service.js#submitLessonAssessment from violations.device_detected,
    // never client-supplied. A 'malpractice' attempt permanently blocks
    // retaking that lesson's assessment — see
    // course.service.js#getLessonAssessment's block-check.
    'status',
  ],
  defaults: { status: 'completed' },
};
