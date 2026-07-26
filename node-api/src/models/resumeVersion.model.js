// A named snapshot of resumeBuilder.model.js's shape at save time — see
// resumeBuilder.service.js#addVersion. python-service let Mongo assign a raw
// ObjectId as this collection's _id (the one place in that codebase that
// didn't hand-roll a sequential int id); node-api uses its usual UUID _id
// here instead, consistent with every other collection in this service.
module.exports = {
  tableName: 'resume_versions',
  columns: [
    'student_id', 'name', 'template', 'zoom',
    'personal', 'objective', 'education', 'experience', 'projects', 'skills',
    'certifications', 'internships', 'achievements', 'hackathons', 'publications',
    'languages', 'volunteer', 'references', 'customSections', 'sectionOrder',
  ],
};
