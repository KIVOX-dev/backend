// An employee record for an HR organisation: profile, documents, onboarding
// checklist, skills/certifications and performance reviews all live on one
// document so a profile is a single read.
module.exports = {
  tableName: 'hr_employees',
  columns: [
    'org_id', 'created_by', 'employee_code', 'user_id', 'student_id', 'application_id', 'placement_id',
    'full_name', 'email', 'phone', 'designation', 'department', 'employment_type', 'location',
    'manager_name', 'join_date', 'exit_date', 'status',
    'skills', 'certifications', 'documents', 'onboarding', 'performance_reviews',
  ],
  defaults: {
    status: 'onboarding', employment_type: 'full_time',
    skills: [], certifications: [], documents: [], performance_reviews: [], onboarding: { tasks: [], progress: 0 },
  },
};
