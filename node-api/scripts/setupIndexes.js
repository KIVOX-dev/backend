// MongoDB has no CREATE TABLE / FK / CHECK constraints — this script is the Mongo equivalent
// of the old sql/schema.sql: it creates every collection's indexes (uniqueness + query
// performance) up front. Idempotent — safe to re-run any time. Usage: npm run db:setup-indexes
//
// Note on what this does NOT replicate from the old Postgres schema:
//  - No foreign keys, so referential integrity (e.g. a placement_application pointing at a
//    real placement/student) is enforced in the service layer, not the database.
//  - No CHECK constraints (cgpa range, positive durations, etc.) — enforced by Joi validation
//    at the API boundary instead.
//  - No native ENUM types — valid values (roles, statuses) are enforced by Joi, not storage.
const { connect, getDb, close } = require('../src/config/database');
const logger = require('../src/utils/logger');

const INDEX_PLAN = {
  users: [
    { key: { email: 1 }, options: { unique: true } },
    { key: { google_id: 1 }, options: { unique: true, sparse: true } },
    { key: { role: 1 }, options: {} },
    { key: { institution_id: 1 }, options: {} },
    // Sparse — set on only a small fraction of users at any time (an
    // in-flight reset/verification link) — see user.repository.js's
    // findByResetToken/findByEmailVerificationToken, both unindexed full
    // collection scans before this.
    { key: { reset_password_token_hash: 1 }, options: { sparse: true } },
    { key: { email_verification_token_hash: 1 }, options: { sparse: true } },
  ],
  institutions: [
    { key: { code: 1 }, options: { unique: true } },
    { key: { is_active: 1 }, options: {} },
  ],
  departments: [
    { key: { institution_id: 1, code: 1 }, options: { unique: true } },
  ],
  college_admins: [
    { key: { user_id: 1 }, options: { unique: true } },
    { key: { institution_id: 1 }, options: {} },
  ],
  companies: [
    { key: { is_active: 1 }, options: {} },
  ],
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
  tests: [
    { key: { institution_id: 1 }, options: {} },
  ],
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
  notifications: [
    { key: { user_id: 1, is_read: 1 }, options: {} },
  ],
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
  assessment_attempts: [
    { key: { student_id: 1 }, options: {} },
  ],
  interview_attempts: [
    { key: { student_id: 1 }, options: {} },
  ],
  // interview_responses has no student_id field at all (see
  // models/interviewResponse.model.js's columns) — every response is looked
  // up by attempt_id (student.service.js#logInterview is the only writer).
  // The previous index here was on student_id, a field that never exists on
  // any document in this collection: a dead index with zero query benefit
  // that still paid write overhead on every insert. See
  // PROJECT_AUDIT_REPORT.md P2-26.
  interview_responses: [
    { key: { attempt_id: 1 }, options: {} },
  ],
  resume_versions: [
    { key: { student_id: 1, created_at: -1 }, options: {} },
  ],
  profile_data: [
    { key: { user_id: 1 }, options: { unique: true } },
  ],
  user_data_states: [
    { key: { user_id: 1 }, options: { unique: true } },
  ],
  batches: [
    { key: { institution_id: 1 }, options: {} },
    { key: { status: 1 }, options: {} },
  ],
  batch_students: [
    { key: { batch_id: 1, student_id: 1 }, options: { unique: true } },
  ],
  placement_records: [
    { key: { student_id: 1 }, options: {} },
    // placementRecord.service.js#list/#listForStudent filter by institution_id
    // for every non-super-admin caller (the common case) — without this,
    // every institution-scoped fetch is an unindexed collection scan.
    { key: { institution_id: 1 }, options: {} },
  ],
  messages: [
    { key: { sender_id: 1, receiver_id: 1, created_at: -1 }, options: {} },
    { key: { receiver_id: 1, sender_id: 1, created_at: -1 }, options: {} },
  ],
  // Institution-agnostic practice-bank content — see models/question.model.js.
  // question.repository.js#sampleRandom always $matches on category before
  // $sample-ing; without this, every assigned-test draw was a full
  // collection scan of the entire question bank before the random sample.
  questions: [
    { key: { category: 1 }, options: {} },
  ],
};

async function main() {
  await connect();
  const db = getDb();

  for (const [collectionName, indexes] of Object.entries(INDEX_PLAN)) {
    for (const { key, options } of indexes) {
      await db.collection(collectionName).createIndex(key, options);
    }
    logger.info(`Indexes ready: ${collectionName}`, { count: indexes.length });
  }

  logger.info('All indexes created/verified');
  await close();
  process.exit(0);
}

main().catch((err) => {
  logger.error('Index setup failed', { error: err.message });
  process.exit(1);
});
