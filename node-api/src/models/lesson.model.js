module.exports = {
  tableName: 'lessons',
  columns: [
    'course_id',
    'youtube_video_id',
    'title',
    'thumbnail_url',
    'duration_seconds',
    // 0-based order within the course — playlist position, or 0 for a
    // single-video course.
    'position',
    // The 10-question quiz backing this lesson's Assessment tab (see
    // course.service.js#getLessonAssessment) — generated once, lazily, on
    // first request, then cached here rather than re-generated per student.
    // Each item: { question, options: string[4], correct_answer }.
    // correct_answer is stripped before ever reaching a student — see
    // course.controller.js#getLessonAssessment.
    'assessment_questions',
    // At most one name from config/skillCatalog.js, matched against this
    // lesson's own title the same moment assessment_questions is generated
    // (both cached together, both derived from the same title, neither
    // redone on a later visit) — null if no catalog skill matched. Passing
    // this lesson's assessment progresses that skill's badge — see
    // course.service.js#_awardSkillProgress.
    'skill_name',
  ],
};
