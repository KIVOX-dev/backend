module.exports = {
  tableName: 'student_skill_badges',
  columns: [
    'student_id',
    'skill_name',
    // Every lesson.id that has already contributed a passing attempt to this
    // skill — a student retaking the SAME lesson's quiz doesn't inflate
    // badge_count further, only a genuinely new lesson does. See
    // course.service.js#_awardSkillProgress.
    'lesson_ids',
    'badge_count',
    'certificate_issued',
  ],
  defaults: { lesson_ids: [], badge_count: 0, certificate_issued: false },
};
