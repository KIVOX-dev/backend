// PHASE 2/3/4 migration runner.
//
// Usage:  node migration/migrate.js                (from node-api/)
//         npm run migrate:run                       (see package.json)
//
// What this does and does NOT do:
//  - Reads from the EXISTING MongoDB through migration/lib/sourceDb.js, a
//    module that exposes ONLY read operations (connect/list/count/findBatch).
//    There is no code path here that can write to, modify, or drop anything
//    in the source database.
//  - Writes into Firestore (MongoDB compatibility) through
//    migration/lib/targetDb.js, authenticated via OIDC using the connection
//    string Google generated (read from FIRESTORE_MONGODB_URI — never
//    hardcoded, never logged).
//  - Copies every collection currently in the source database (discovered
//    dynamically via listCollections, not a hardcoded list — see Phase 1
//    report: 28 collections today, but this adapts if more appear later).
//  - Upserts each document by its existing _id (replaceOne with the whole
//    document as the replacement) — running this script again is a no-op
//    for already-migrated documents, never a duplicate.
//  - Batches with cursor pagination (see lib/sourceDb.js#findBatch) and
//    checkpoints progress per collection (lib/checkpoint.js) so an
//    interrupted run resumes instead of restarting.
//  - Retries transient errors with backoff (lib/retry.js); a document that
//    fails permanently is recorded as a failure and the run continues with
//    the rest of the batch rather than aborting.
//  - Never proceeds to imply "done" if source/target counts don't match —
//    the final report marks the run MISMATCH and this is surfaced to the
//    user before anything else happens (per Phase 4/9 of the migration plan
//    this tool was built for).
const fs = require('fs');
const path = require('path');
const env = require('./lib/env');
const logger = require('./lib/logger');
const source = require('./lib/sourceDb');
const target = require('./lib/targetDb');
const checkpoint = require('./lib/checkpoint');
const { withRetry } = require('./lib/retry');

async function migrateCollection(collectionName) {
  const sourceCount = await source.countDocuments(collectionName);
  let state = checkpoint.load(collectionName);
  let failedCount = 0;
  const failedIds = [];

  if (sourceCount === 0) {
    logger.info('Collection is empty on source, nothing to copy', { collectionName });
    checkpoint.save(collectionName, { lastId: null, migratedCount: 0, completed: true });
  } else if (state.completed) {
    logger.info('Collection already marked complete from a previous run, re-verifying only', {
      collectionName,
      migratedCount: state.migratedCount,
    });
  } else {
    logger.info('Starting collection migration', {
      collectionName,
      sourceCount,
      resumingFrom: state.lastId,
      alreadyMigrated: state.migratedCount,
    });

    for (;;) {
      const batch = await withRetry(
        () => source.findBatch(collectionName, { after: state.lastId, limit: env.batchSize }),
        { maxRetries: env.maxRetries, baseDelayMs: env.retryBaseDelayMs, label: `${collectionName}:read` }
      );
      if (batch.length === 0) break;

      const db = target.getDb();
      const ops = batch.map((doc) => ({
        replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
      }));

      try {
        await withRetry(() => db.collection(collectionName).bulkWrite(ops, { ordered: false }), {
          maxRetries: env.maxRetries,
          baseDelayMs: env.retryBaseDelayMs,
          label: `${collectionName}:write`,
        });
      } catch (err) {
        // BulkWriteError with ordered:false still applies every non-failing op;
        // err.writeErrors tells us exactly which ones in this batch didn't.
        const writeErrors = err.writeErrors || (err.result && err.result.getWriteErrors && err.result.getWriteErrors()) || [];
        if (writeErrors.length === 0) throw err; // not a partial-batch failure, a real problem
        for (const we of writeErrors) {
          const failedDoc = batch[we.index];
          failedCount += 1;
          failedIds.push(failedDoc && failedDoc._id);
          logger.error('Document failed to migrate after retries', we, { collectionName, docId: failedDoc && failedDoc._id });
        }
      }

      state = {
        lastId: batch[batch.length - 1]._id,
        migratedCount: state.migratedCount + batch.length - (failedCount || 0),
        completed: false,
      };
      checkpoint.save(collectionName, state);
      logger.info('Batch migrated', { collectionName, batchSize: batch.length, totalMigrated: state.migratedCount, lastId: state.lastId });

      if (env.batchDelayMs > 0) await new Promise((r) => setTimeout(r, env.batchDelayMs));
    }

    checkpoint.save(collectionName, { ...state, completed: true });
  }

  const targetCount = await target.getDb().collection(collectionName).countDocuments();
  const match = targetCount === sourceCount;

  return { collectionName, sourceCount, targetCount, migratedCount: state.migratedCount, failedCount, failedIds, match };
}

async function main() {
  logger.info('Migration started');
  await source.connect();
  await target.connect();

  const collectionNames = await source.listCollectionNames();
  logger.info('Collections discovered on source', { count: collectionNames.length, collectionNames });

  const results = [];
  for (const name of collectionNames) {
    const result = await migrateCollection(name);
    results.push(result);
  }

  const overallMatch = results.every((r) => r.match && r.failedCount === 0);
  const report = {
    status: overallMatch ? 'SUCCESS' : 'MISMATCH',
    generatedAt: new Date().toISOString(),
    collections: results,
    totals: {
      sourceDocuments: results.reduce((s, r) => s + r.sourceCount, 0),
      targetDocuments: results.reduce((s, r) => s + r.targetCount, 0),
      migratedDocuments: results.reduce((s, r) => s + r.migratedCount, 0),
      failedDocuments: results.reduce((s, r) => s + r.failedCount, 0),
    },
  };

  const reportsDir = path.join(__dirname, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `migrate-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n=== MIGRATION REPORT ===');
  console.table(
    results.map((r) => ({
      collection: r.collectionName,
      source: r.sourceCount,
      target: r.targetCount,
      migrated: r.migratedCount,
      failed: r.failedCount,
      match: r.match ? 'YES' : 'NO',
    }))
  );
  console.log(`Overall status: ${report.status}`);
  console.log(`Report written to: ${reportPath}`);

  if (!overallMatch) {
    console.log('\n*** MISMATCH DETECTED — DO NOT PROCEED TO PRODUCTION CUTOVER ***');
    console.log('Re-run this script to retry (it is resumable/idempotent), then investigate any collections still failing.');
  }

  await source.close();
  await target.close();
  process.exit(overallMatch ? 0 : 1);
}

main().catch(async (err) => {
  logger.error('Migration failed with an unhandled error', err);
  try {
    await source.close();
    await target.close();
  } catch {
    /* already closing, ignore */
  }
  process.exit(1);
});
