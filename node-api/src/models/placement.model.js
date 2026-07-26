module.exports = {
  tableName: 'placements',
  columns: [
    'company_id', 'institution_id', 'created_by', 'title', 'description',
    'job_type', 'package_lpa', 'eligibility_criteria', 'application_deadline',
    'drive_date', 'status',
    // Ported from python-service's jobs.py (job_postings) — same real-world
    // concept as the columns above (a posting students apply to), just with
    // more granular fields. company_name is free text on purpose: a posting
    // doesn't require the company to already exist in node-api's `companies`
    // collection, matching python's behavior.
    'recruiter_id', 'company_name', 'location', 'salary_min_lpa', 'salary_max_lpa',
    'required_skills', 'eligible_departments', 'eligible_years', 'min_cgpa', 'is_active',
  ],
  defaults: { job_type: 'full_time', eligibility_criteria: {}, status: 'draft', is_active: true },
};
