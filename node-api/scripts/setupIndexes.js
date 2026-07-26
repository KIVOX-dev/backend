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
  ],
  tests: [
    { key: { institution_id: 1 }, options: {} },
  ],
  test_assignments: [
    { key: { test_id: 1, student_id: 1 }, options: { unique: true } },
    { key: { student_id: 1 }, options: {} },
    { key: { status: 1 }, options: {} },
  ],
  results: [
    { key: { test_assignment_id: 1 }, options: { unique: true } },
    { key: { student_id: 1 }, options: {} },
    { key: { test_id: 1 }, options: {} },
  ],
  notifications: [
    { key: { user_id: 1, is_read: 1 }, options: {} },
  ],
  resume_builder: [
    { key: { student_id: 1 }, options: { unique: true } },
  ],
  activity_logs: [
    { key: { user_id: 1 }, options: {} },
    { key: { created_at: 1 }, options: {} },
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
