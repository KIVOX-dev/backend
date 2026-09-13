// Connection to Firestore with MongoDB compatibility, via OIDC.
//
// The connection string comes ENTIRELY from Google's generated URI (env var
// FIRESTORE_MONGODB_URI, see .env.migration.example) and is passed to
// MongoClient unmodified — no extra auth params are invented here. Google's
// URI already carries every required option:
//   loadBalanced=true                                   (required for Firestore's proxy)
//   tls=true                                             (required)
//   retryWrites=false                                    (required — retryable writes are unsupported)
//   authMechanism=MONGODB-OIDC
//   authMechanismProperties=ENVIRONMENT:gcp,TOKEN_RESOURCE:FIRESTORE
//
// Requires mongodb driver >=6.7 for MONGODB-OIDC + ENVIRONMENT:gcp support
// (this repo is on ^6.10.0 — confirmed sufficient).
//
// Authentication itself happens via Application Default Credentials: locally
// via `gcloud auth application-default login`, and on Cloud Run automatically
// via the attached service account. No credentials are configured here.
const { MongoClient } = require('mongodb');
const env = require('./env');
const logger = require('./logger');

let client = null;
let db = null;

async function connect() {
  if (db) return db;
  client = new MongoClient(env.target.uri, { maxPoolSize: 10 });
  await client.connect();
  // The database name is already part of Google's generated URI path
  // (…firestore.goog:443/talentsnaps?…) — db() with no argument uses it.
  db = client.db();
  logger.info('Connected to Firestore (MongoDB compatibility) via OIDC', { database: db.databaseName });
  return db;
}

function getDb() {
  if (!db) throw new Error('Target Firestore DB not connected yet — connect() must complete first');
  return db;
}

async function close() {
  if (client) await client.close();
  client = null;
  db = null;
}

module.exports = { connect, getDb, close };
