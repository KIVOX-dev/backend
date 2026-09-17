module.exports = {
  tableName: 'student_certificates',
  columns: [
    'student_id',
    'skill_name',
    // The document's own `id` (BaseRepository's app-generated UUID) doubles
    // as the public credential id — see certificateVerification.routes.js's
    // GET /certificates/:id/verify (unauthenticated, anyone with the link —
    // e.g. a recruiter following the LinkedIn "Show credential" button —
    // can confirm it's real) and studentSkill.service.js's LinkedIn
    // ADD_TO_PROFILE certUrl/certId, both built from it directly.
    'issued_at',
  ],
};
