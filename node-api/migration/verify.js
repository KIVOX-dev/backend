// PHASE 5 verification — independent of migrate.js's own count check.
// Re-reads every document from BOTH databases (read-only on both sides) and
// compares them field-for-field via a canonical checksum, so a document that
// merely LOOKS present but has a dropped/changed field would be caught even
// if migrate.js's document counts happened to match.
//
// Usage: node migration/verify.js   (from node-api/)
//        npm run migrate:verify
const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');
const source = require('./lib/sourceDb');
const target = require('./lib/targetDb');
const { hashDocument } = require('./lib/canonicalize');

const PAGE_SIZE = 1000;

// Read-only pagination helper for whichever db is passed in — mirrors
// sourceDb.js#findBatch's cursor-by-_id approach so this works identically
// against the source MongoDB and the target Firestore collection.
async function* iterateAll(db, collectionName) {
  let after = null;
  for (;;) {
    const filter = after !== null ? { _id: { $gt: after } } : {};
    const docs = await db.collection(collectionName).find(filter).sort({ _id: 1 }).limit(PAGE_SIZE).toArray();
    if (docs.length === 0) return;
    for (const doc of docs) yield doc;
    after = docs[docs.length - 1]._id;
  }
}

async function verifyCollection(collectionName, sourceDb, targetDb) {
  const sourceHashes = new Map();
  const targetHashes = new Map();

  for await (const doc of iterateAll(sourceDb, collectionName)) {
    sourceHashes.set(doc._id, hashDocument(doc));
  }
  for await (const doc of iterateAll(targetDb, collectionName)) {
    targetHashes.set(doc._id, hashDocument(doc));
  }

  const missingInTarget = [];
  const contentMismatches = [];
  for (const [id, hash] of sourceHashes) {
    if (!targetHashes.has(id)) {
      missingInTarget.push(id);
    } else if (targetHashes.get(id) !== hash) {
      contentMismatches.push(id);
    }
  }
  const unexpectedInTarget = [...targetHashes.keys()].filter((id) => !sourceHashes.has(id));

  const differences = [];
  if (missingInTarget.length) differences.push(`${missingInTarget.length} missing in Firestore`);
  if (contentMismatches.length) differences.push(`${contentMismatches.length} content mismatch`);
  if (unexpectedInTarget.length) differences.push(`${unexpectedInTarget.length} unexpected extra in Firestore`);

  return {
    collectionName,
    mongoCount: sourceHashes.size,
    firestoreCount: targetHashes.size,
    match: differences.length === 0,
    differences: differences.join('; ') || 'none',
    missingInTargetIds: missingInTarget,
    contentMismatchIds: contentMismatches,
    unexpectedInTargetIds: unexpectedInTarget,
  };
}

async function main() {
  logger.info('Verification started');
  const sourceDb = await source.connect();
  const targetDb = await target.connect();

  const collectionNames = await source.listCollectionNames();
  const results = [];
  for (const name of collectionNames) {
    logger.info('Verifying collection', { collectionName: name });
    const result = await verifyCollection(name, sourceDb, targetDb);
    results.push(result);
  }

  const allMatch = results.every((r) => r.match);

  const reportsDir = path.join(__dirname, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `verify-${Date.now()}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ status: allMatch ? 'SUCCESS' : 'MISMATCH', generatedAt: new Date().toISOString(), collections: results }, null, 2)
  );

  console.log('\n=== VERIFICATION REPORT ===');
  console.log('COLLECTION | MONGODB COUNT | FIRESTORE COUNT | MATCH | DIFFERENCES');
  for (const r of results) {
    console.log(`${r.collectionName} | ${r.mongoCount} | ${r.firestoreCount} | ${r.match ? 'YES' : 'NO'} | ${r.differences}`);
  }
  console.log(`\nOverall status: ${allMatch ? 'SUCCESS' : 'MISMATCH'}`);
  console.log(`Report written to: ${reportPath}`);
  if (!allMatch) {
    console.log('\n*** VERIFICATION FAILED — data migration is NOT considered successful. Do not proceed to production cutover. ***');
  }

  await source.close();
  await target.close();
  process.exit(allMatch ? 0 : 1);
}

main().catch(async (err) => {
  logger.error('Verification failed with an unhandled error', err);
  try {
    await source.close();
    await target.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
