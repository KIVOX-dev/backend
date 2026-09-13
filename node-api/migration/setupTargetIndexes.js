// PHASE 7 — recreate indexes on the Firestore (MongoDB compatibility) target.
// Does NOT touch the source MongoDB in any way. Does NOT assume indexes
// migrated automatically (Firestore's docs confirm they do not) — this
// explicitly (re)creates every index from lib/indexPlan.js and reports which
// ones succeeded vs. failed, rather than silently trusting they're there.
//
// Idempotent (createIndex is a no-op if the index already exists with the
// same spec) — safe to re-run.
//
// Usage: node migration/setupTargetIndexes.js
//        npm run migrate:setup-indexes
const target = require('./lib/targetDb');
const logger = require('./lib/logger');
const { INDEX_PLAN } = require('./lib/indexPlan');

async function main() {
  const db = await target.connect();
  const results = [];

  for (const [collectionName, indexes] of Object.entries(INDEX_PLAN)) {
    for (const { key, options } of indexes) {
      try {
        await db.collection(collectionName).createIndex(key, options);
        results.push({ collectionName, key, options, status: 'CREATED' });
        logger.info('Index created/verified', { collectionName, key, options });
      } catch (err) {
        results.push({ collectionName, key, options, status: 'FAILED', error: err.message });
        logger.error('Index creation FAILED — this index cannot be recreated as-is on Firestore', err, { collectionName, key, options });
      }
    }
  }

  console.log('\n=== TARGET INDEX SETUP REPORT ===');
  console.table(
    results.map((r) => ({
      collection: r.collectionName,
      key: JSON.stringify(r.key),
      options: JSON.stringify(r.options),
      status: r.status,
    }))
  );

  const failed = results.filter((r) => r.status === 'FAILED');
  if (failed.length > 0) {
    console.log(`\n${failed.length} index(es) could not be created — see errors above. Do not assume query performance parity until these are resolved.`);
  } else {
    console.log('\nAll indexes created/verified successfully on the Firestore target.');
  }

  await target.close();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  logger.error('Index setup failed with an unhandled error', err);
  try {
    await target.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
