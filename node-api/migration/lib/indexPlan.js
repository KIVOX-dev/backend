// Mirror of the INDEX_PLAN in ../../scripts/setupIndexes.js (the app's
// existing, authoritative index definition — see Phase 1 report). Duplicated
// here rather than imported so this migration tool has zero require() path
// into scripts/ or src/, and so running it never risks touching anything
// under version control for the live application.
//
// ⚠️ KEEP IN SYNC with scripts/setupIndexes.js by hand. If that file changes,
// update this copy before re-running migration/setupTargetIndexes.js.
//
// Known drift as of the Phase 1 analysis: scripts/setupIndexes.js currently
// defines `interview_responses: { attempt_id: 1 }`, but the LIVE MongoDB
// database still has the older `{ student_id: 1 }` index (it hasn't been
// re-run since that change). This copy uses the CURRENT CODE's plan
// (attempt_id), i.e. the intended state, not whatever happens to be live —
// confirm this is what you want before running setupTargetIndexes.js.
const INDEX_PLAN = {
  users: [
    { key: { email: 1 }, options: { unique: true } },
    { key: { google_id: 1 }, options: { unique: true, sparse: true } },
    { key: { role: 1 }, options: {} },
    { key: { institution_id: 1 }, options: {} },
    { key: { reset_password_token_hash: 1 }, options: { sparse: true } },
    { key: { email_verification_token_hash: 1 }, options: { sparse: true } },
  ],
  institutions: [
    { key: { code: 1 }, options: { unique: true } },
    { key: { is_active: 1 }, options: {} },
  ],
  departments: [{ key: { institution_id: 1, code: 1 }, options: { unique: true } }],
  college_admins: [
    { key: { user_id: 1 }, options: { unique: true } },
    { key: { institution_id: 1 }, options: {} },
  ],
  companies: [{ key: { is_active: 1 }, options: {} }],
  hr: [
    { key: { user_id: 1 }, options: { unique: true } },
    { key: { company_id: 1 }, options: {} },
  ],
  faculty: [
    { key: { user_id: 1 }, options: { unique: true } },
    { key: { institution_id: 1 }, options: {} },
    { key: { department_id: 1 }, options: {} },
  ],
  students: [
    { key: { user_id: 1 }, options: { unique: true } },
    { key: { institution_id: 1, roll_number: 1 }, options: { unique: true } },
    { key: { department_id: 1 }, options: {} },
    { key: { batch_year: 1 }, options: {} },
  ],
  placements: [
    { key: { institution_id: 1 }, options: {} },
    { key: { company_id: 1 }, options: {} },
    { key: { status: 1 }, options: {} },
  ],
  placement_applications: [
    { key: { placement_id: 1, student_id: 1 }, options: { unique: true } },
    { key: { student_id: 1 }, options: {} },
    { key: { status: 1 }, options: {} },
    { key: { institution_id: 1 }, options: {} },
  ],
  tests: [{ key: { institution_id: 1 }, options: {} }],
  test_assignments: [
    { key: { test_id: 1, student_id: 1 }, options: { unique: true } },
    { key: { student_id: 1 }, options: {} },
    { key: { status: 1 }, options: {} },
    { key: { institution_id: 1 }, options: {} },
  ],
  results: [
    { key: { test_assignment_id: 1 }, options: { unique: true } },
    { key: { student_id: 1 }, options: {} },
    { key: { test_id: 1 }, options: {} },
    { key: { institution_id: 1 }, options: {} },
  ],
  notifications: [{ key: { user_id: 1, is_read: 1 }, options: {} }],
  resume_builder: [
    { key: { student_id: 1 }, options: { unique: true } },
    { key: { institution_id: 1 }, options: {} },
  ],
  activity_logs: [
    { key: { user_id: 1 }, options: {} },
    { key: { created_at: 1 }, options: {} },
  ],
  achievements: [
    { key: { student_id: 1 }, options: {} },
    { key: { student_id: 1, achievement_type: 1 }, options: {} },
  ],
  assessment_attempts: [{ key: { student_id: 1 }, options: {} }],
  interview_attempts: [{ key: { student_id: 1 }, options: {} }],
  interview_responses: [{ key: { attempt_id: 1 }, options: {} }],
  resume_versions: [{ key: { student_id: 1, created_at: -1 }, options: {} }],
  profile_data: [{ key: { user_id: 1 }, options: { unique: true } }],
  user_data_states: [{ key: { user_id: 1 }, options: { unique: true } }],
  batches: [
    { key: { institution_id: 1 }, options: {} },
    { key: { status: 1 }, options: {} },
  ],
  batch_students: [{ key: { batch_id: 1, student_id: 1 }, options: { unique: true } }],
  placement_records: [
    { key: { student_id: 1 }, options: {} },
    { key: { institution_id: 1 }, options: {} },
  ],
  messages: [
    { key: { sender_id: 1, receiver_id: 1, created_at: -1 }, options: {} },
    { key: { receiver_id: 1, sender_id: 1, created_at: -1 }, options: {} },
  ],
  questions: [{ key: { category: 1 }, options: {} }],
};

module.exports = { INDEX_PLAN };
