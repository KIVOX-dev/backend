// One-off backfill for accounts that self-registered (POST /auth/register or
// Google sign-up) as role=student before auth.service.js#register/googleLogin
// were fixed to create a matching `students` row alongside the `users` row.
// Every institution-scoped feature (tests, dashboard, placements) resolves
// through students.findByUserId(user_id) — a student user with no `students`
// row silently 404s/empty-lists everywhere, with no error surfaced to them.
//
// Idempotent — only touches users with role=student that have no matching
// students.user_id, so it's safe to re-run. Usage: npm run db:backfill-student-profiles
const { connect, getDb, close } = require('../src/config/database');
const logger = require('../src/utils/logger');

async function main() {
  await connect();
  const db = getDb();

  const studentUsers = await db.collection('users').find({ role: 'student' }).toArray();
  const existingProfileUserIds = new Set(
    (await db.collection('students').find({}, { projection: { user_id: 1 } }).toArray()).map((s) => s.user_id)
  );

  const missing = studentUsers.filter((u) => !existingProfileUserIds.has(u._id));
  if (missing.length === 0) {
    logger.info('No student users are missing a profile — nothing to backfill.');
    await close();
    return;
  }

  const now = new Date();
  const docs = missing.map((u) => ({
    _id: require('crypto').randomUUID(),
    user_id: u._id,
    institution_id: u.institution_id || null,
    department_id: null,
    roll_number: null,
    batch_year: null,
    cgpa: null,
    resume_url: null,
    placement_status: null,
    tests_completed: null,
    avg_accuracy: null,
    streak_days: null,
    interviews_completed: null,
    last_test_date: null,
    year_of_study: null,
    semester: null,
    section: null,
    phone: null,
    date_of_birth: null,
    gender: null,
    address: null,
    profile_completed: false,
    created_at: now,
    updated_at: now,
  }));

  await db.collection('students').insertMany(docs);

  logger.info('Student profile backfill complete', {
    scanned: studentUsers.length,
    created: docs.length,
    emails: missing.map((u) => u.email),
  });

  await close();
}

main().catch((err) => {
  logger.error('Student profile backfill failed', { error: err.message });
  process.exit(1);
});
