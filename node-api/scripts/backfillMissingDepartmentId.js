// One-off backfill for students whose `students.department_id` was never
// resolved, even though the human-readable department name landed on
// `users.department` (shown as-is in Manage Users, which is why these
// accounts look completely normal there). department_id is the field every
// department-scoped query actually filters on — bulk test assignment
// (testAssignment.service.js#create) chief among them — so a student
// missing it can never be matched no matter what department/batch year an
// admin picks, with no error surfaced beyond a generic "no students match".
//
// Common cause: a roster upload (FacultyUpload.tsx) whose Department column
// didn't match any real department by name/code at import time (e.g. the
// department row was created afterwards) — resolveDepartmentIdByName() below
// re-runs that same match now that the department may actually exist. Same
// logic user.service.js#approve() now runs going forward at approval time;
// this script is only for accounts that were already approved before that
// fix landed.
//
// Idempotent — only touches students with no department_id (or an
// unresolvable one) that have a resolvable users.department name, so it's
// safe to re-run. Usage: npm run db:backfill-department-id
const { connect, getDb, close } = require('../src/config/database');
const { resolveDepartmentIdByName } = require('../src/utils/departmentMatch');
const logger = require('../src/utils/logger');

async function main() {
  await connect();
  const db = getDb();

  // Mongo's null-equality query matches both an explicit null and a field
  // that's absent entirely — both cases seen in practice here.
  const candidates = await db.collection('students').find({ department_id: null }).toArray();
  if (candidates.length === 0) {
    logger.info('No students are missing department_id — nothing to backfill.');
    await close();
    return;
  }

  const userIds = candidates.map((s) => s.user_id);
  const users = await db.collection('users').find({ _id: { $in: userIds } }).toArray();
  const userById = new Map(users.map((u) => [u._id, u]));

  const departmentsByInstitution = new Map();
  const getDepartments = async (institutionId) => {
    if (!departmentsByInstitution.has(institutionId)) {
      const departments = await db.collection('departments').find({ institution_id: institutionId }).toArray();
      departmentsByInstitution.set(institutionId, departments.map((d) => ({ id: d._id, name: d.name, code: d.code })));
    }
    return departmentsByInstitution.get(institutionId);
  };

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for (const student of candidates) {
    scanned += 1;
    const user = userById.get(student.user_id);
    if (!user || !user.department || !student.institution_id) {
      skipped += 1;
      continue;
    }

    const departments = await getDepartments(student.institution_id);
    const departmentId = resolveDepartmentIdByName(user.department, departments);
    if (!departmentId) {
      logger.warn('Skipping student with unresolvable department name', {
        studentId: student._id,
        department: user.department,
      });
      skipped += 1;
      continue;
    }

    await db.collection('students').updateOne(
      { _id: student._id },
      { $set: { department_id: departmentId, updated_at: new Date() } }
    );
    updated += 1;
  }

  logger.info('department_id backfill finished', { scanned, updated, skipped });
  await close();
  process.exit(0);
}

main().catch((err) => {
  logger.error('department_id backfill failed', { error: err.message });
  process.exit(1);
});
