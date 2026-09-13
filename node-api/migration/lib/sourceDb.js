// Connection to the EXISTING, production MongoDB — READ-ONLY by construction.
// This module intentionally exposes ONLY read operations. There is no
// insertOne/updateOne/deleteOne/drop/etc. anywhere below, and no other file
// in migration/ imports `mongodb` directly for the source side — so there is
// no code path in this tool that can write to or modify the source database,
// regardless of what a caller does with the returned object.
const { MongoClient } = require('mongodb');
const env = require('./env');
const logger = require('./logger');

let client = null;
let db = null;

async function connect() {
  if (db) return db;
  client = new MongoClient(env.source.uri, { maxPoolSize: 10 });
  await client.connect();
  db = client.db(env.source.dbName);
  logger.info('Connected to source MongoDB (read-only)', { database: env.source.dbName });
  return db;
}

async function listCollectionNames() {
  const database = await connect();
  const collections = await database.listCollections().toArray();
  return collections.map((c) => c.name).filter((name) => !name.startsWith('system.'));
}

async function countDocuments(collectionName) {
  const database = await connect();
  return database.collection(collectionName).countDocuments();
}

// Cursor-based pagination by _id, not skip/limit — avoids the O(n) skip cost
// and gives migrate.js a stable resume point (the last _id seen) independent
// of any writes happening concurrently on collections further ahead in the
// id range. _id is always a string in this app's schema, so string ordering
// is stable and consistent between calls.
function findBatch(collectionName, { after, limit }) {
  const database = db; // connect() must already have been called
  const filter = after !== undefined && after !== null ? { _id: { $gt: after } } : {};
  return database.collection(collectionName).find(filter).sort({ _id: 1 }).limit(limit).toArray();
}

async function close() {
  if (client) await client.close();
  client = null;
  db = null;
}

module.exports = { connect, listCollectionNames, countDocuments, findBatch, close };
