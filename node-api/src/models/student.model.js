module.exports = {
  tableName: 'students',
  columns: [
    'user_id', 'institution_id', 'department_id', 'roll_number',
    'batch_year', 'cgpa', 'resume_url',
    // Ported from python-service's student_profiles collection:
    'placement_status', 'tests_completed', 'avg_accuracy', 'streak_days',
    'interviews_completed', 'last_test_date',
    // Self-service profile completion (College -> Department flow).
    // `year_of_study` (1-4, "which year of the program") is deliberately
    // NOT the same field as `batch_year` above (a calendar year, e.g. 2024,
    // used by the admin-provisioned/batch-import flows) — conflating them
    // would silently redefine batch_year's existing meaning everywhere else
    // it's used.
    'year_of_study', 'semester', 'section', 'phone', 'date_of_birth',
    'gender', 'address', 'profile_completed',
    // Integrations tab — GitHub is a real OAuth connection (see
    // services/githubAuth.service.js); github_id is GitHub's own numeric user
    // id (stable across username changes), used to detect one GitHub account
    // already linked to a different student.
    'github_id', 'github_username', 'github_avatar_url', 'github_connected_at',
    // LeetCode/HackerRank/Dribbble have no public OAuth surface a third party
    // can register against (unlike GitHub) — these are self-reported
    // usernames, best-effort verified against each site at save time (see
    // utils/socialProfileClient.js), not an authenticated connection.
    'leetcode_username', 'hackerrank_username', 'dribbble_username',
    // Real OAuth connections, same pattern as github_* above.
    'linkedin_id', 'linkedin_name', 'linkedin_email', 'linkedin_avatar_url', 'linkedin_connected_at',
    'stackoverflow_id', 'stackoverflow_display_name', 'stackoverflow_reputation',
    'stackoverflow_avatar_url', 'stackoverflow_profile_url', 'stackoverflow_connected_at',
    // Student's own uploaded profile photo/cover banner (Google Cloud
    // Storage URLs — see middlewares/upload.js#verifyAndUploadToGcs).
    // Deliberately separate from users.avatar_url (a different, currently
    // unused field on a different collection).
    'avatar_url', 'cover_image_url',
    // Career tab — self-reported, repeatable entries (see
    // validations/studentProfile.validation.js's workExperienceEntry/
    // educationEntry for shape). Distinct from year_of_study/department_id
    // above, which are this student's single current-institution record;
    // `education` here can hold prior schools too, same as any resume.
    'work_experience', 'education',
    // Self-selected target role (see config/jobRoleCatalog.js) driving the
    // "Choose Your Job Role" setup step and the YouTube-to-Course roadmap tab
    // — an id from that catalog, or null if the student hasn't picked one yet.
    'target_job_role',
  ],
  defaults: { profile_completed: false },
};
