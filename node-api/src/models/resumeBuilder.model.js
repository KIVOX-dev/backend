// Ported from python-service's `resumes` collection — a fully structured
// resume document (not the opaque JSON blob this model held before). Nothing
// in the live frontend ever exercised the old shape (node-api received zero
// traffic until this migration), so extending in place is safe.
//
// customSections/sectionOrder deliberately stay camelCase (breaking node-api's
// usual snake_case column convention) because that's the exact wire format
// the frontend's ResumeSaveRequest payload uses today — renaming them would
// require a translation layer for zero benefit.
module.exports = {
  tableName: 'resume_builder',
  columns: [
    'student_id', 'template', 'zoom',
    'personal', 'objective', 'education', 'experience', 'projects', 'skills',
    'certifications', 'internships', 'achievements', 'hackathons', 'publications',
    'languages', 'volunteer', 'references', 'customSections', 'sectionOrder',
  ],
  defaults: { template: 'modern', zoom: 1.0 },
};
