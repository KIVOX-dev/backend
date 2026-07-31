// One-off backfill for the institution_id denormalization added to
// test_assignments/results/placement_applications/resume_builder (see the
// multi-tenant security refactor). MongoDB has no FK/backfill-on-schema-change
// mechanism, so this walks each collection and stamps institution_id onto
// every document still missing it, resolved via student_id -> students.institution_id.
// Idempotent — only touches docs where institution_id doesn't exist yet, so it's
// safe to re-run (e.g. after manually fixing an orphaned row).
//
// IMPORTANT ROLLOUT NOTE: because repository filters are exact-match, a document
// missing institution_id won't match ANY institution's filter — it becomes
// invisible to its rightful institution until this script runs. Run this in the
// same maintenance window as the code deploy that adds institution_id filtering,
// immediately after, not on a delay. Usage: npm run db:backfill-institution-id
const { connect, getDb, close } = require('../src/config/database');
const logger = require('../src/utils/logger');

const BATCH_SIZE = 500;

// Each entry resolves institution_id via its own student_id field.
const TARGET_COLLECTIONS = ['test_assignments', 'results', 'placement_applications', 'resume_builder'];

async function backfillCollection(db, collectionName, studentInstitutionCache) {
  const collection = db.collection(collectionName);
  const cursor = collection.find({ institution_id: { $exists: false } });

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let batch = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const result = await collection.bulkWrite(batch, { ordered: false });
    updated += result.modifiedCount || 0;
    batch = [];
  };

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned += 1;

    let institutionId = studentInstitutionCache.get(doc.student_id);
    if (institutionId === undefined) {
      const student = await db.collection('students').findOne({ _id: doc.student_id });
      institutionId = student ? student.institution_id : null;
      studentInstitutionCache.set(doc.student_id, institutionId);
    }

    if (!institutionId) {
      logger.warn(`Skipping ${collectionName} doc with unresolved student_id`, {
        docId: doc._id,
        studentId: doc.student_id,
      });
      skipped += 1;
      continue;
    }

    batch.push({
      updateOne: { filter: { _id: doc._id }, update: { $set: { institution_id: institutionId } } },
    });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  logger.info(`Backfill complete: ${collectionName}`, { scanned, updated, skipped });
  return { scanned, updated, skipped };
}

async function main() {
  await connect();
  const db = getDb();
  const studentInstitutionCache = new Map();

  const summary = {};
  for (const collectionName of TARGET_COLLECTIONS) {
    summary[collectionName] = await backfillCollection(db, collectionName, studentInstitutionCache);
  }

  logger.info('institution_id backfill finished', summary);
  await close();
  process.exit(0);
}

main().catch((err) => {
  logger.error('institution_id backfill failed', { error: err.message });
  process.exit(1);
});
