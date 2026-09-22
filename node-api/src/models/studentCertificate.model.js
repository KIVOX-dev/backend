module.exports = {
  tableName: 'student_certificates',
  columns: [
    'student_id',
    // 'skill_name' populated for a per-skill certificate (5 passed lessons of
    // that skill — see course.service.js#_awardSkillProgress); 'role_id'/
    // 'role_title' populated instead for a role certificate (every skill in a
    // config/jobRoleCatalog.js role certified — see
    // roadmap.service.js#_maybeIssueRoleCertificate). `type` tells the reader
    // which pair is populated; exactly one pair is ever set on a given row.
    'type',
    'skill_name',
    'role_id',
    'role_title',
    // The document's own `id` (BaseRepository's app-generated UUID) doubles
    // as the public credential id — see certificateVerification.routes.js's
    // GET /certificates/:id/verify (unauthenticated, anyone with the link —
    // e.g. a recruiter following the LinkedIn "Show credential" button —
    // can confirm it's real) and studentSkill.service.js's LinkedIn
    // ADD_TO_PROFILE certUrl/certId, both built from it directly.
    'issued_at',
  ],
  defaults: { type: 'skill' },
};
