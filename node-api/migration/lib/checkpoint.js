// Per-collection progress tracking, so an interrupted migration run can
// resume from the last successfully migrated document instead of starting
// over. Stored as plain JSON files under migration/.checkpoints/ (gitignored
// — this is run-local state, never committed).
//
// Idempotency note: even without checkpoints, re-running the migration is
// safe because every write is an upsert keyed on _id (see migrate.js) — a
// document already migrated just gets overwritten with the same content.
// Checkpoints exist purely to avoid RE-READING and RE-UPSERTING millions of
// already-done documents on a large collection after a restart; at this
// app's current data volume they're a nice-to-have, not a correctness
// requirement — but Phase 2 asked for resumability explicitly, and this
// keeps that true regardless of how large collections grow later.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '.checkpoints');

function file(collectionName) {
  return path.join(DIR, `${collectionName}.json`);
}

function load(collectionName) {
  try {
    const raw = fs.readFileSync(file(collectionName), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return { lastId: null, migratedCount: 0, completed: false };
    throw err;
  }
}

function save(collectionName, state) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file(collectionName), JSON.stringify(state, null, 2));
}

function reset(collectionName) {
  try {
    fs.unlinkSync(file(collectionName));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = { load, save, reset };
