// MongoDB connection using the official `mongodb` driver.
// This is the ONLY module in the codebase allowed to talk to the database driver directly —
// everything else goes through repositories, which use getDb()/getCollection() from here.
const dns = require('dns');
const { MongoClient } = require('mongodb');
const env = require('./env');
const logger = require('../utils/logger');

// Some local networks/VPNs point Node at a resolver that can't answer the SRV/TXT lookups
// `mongodb+srv://` needs, even though the same host resolves fine elsewhere. Opt-in override,
// not needed in Cloud Run/most environments — only set DNS_SERVERS if `npm run db:test` reports
// a "querySrv ECONNREFUSED" error.
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));
}

const client = new MongoClient(env.mongo.uri, {
  maxPoolSize: env.mongo.poolMax,
});

let db = null;
let connectPromise = null;

// Idempotent: safe to call multiple times, only connects once. Must be awaited
// once at server startup, before the app accepts traffic — see src/server.js.
async function connect() {
  if (db) return db;
  if (!connectPromise) {
    connectPromise = client
      .connect()
      .then(() => {
        db = client.db(env.mongo.dbName);
        logger.info('Connected to MongoDB', { database: env.mongo.dbName });
        return db;
      })
      .catch((err) => {
        connectPromise = null; // allow a retry on the next call instead of caching a rejected promise
        throw err;
      });
  }
  return connectPromise;
}

function getDb() {
  if (!db) {
    throw new Error('MongoDB not connected yet — connect() must complete before handling requests');
  }
  return db;
}

function getCollection(name) {
  return getDb().collection(name);
}

// Used by the /health/ready check (routes/health.routes.js) — a real
// round-trip to Mongo, not just "is the client object connected", so
// readiness reflects whether Mongo can actually answer right now.
async function ping() {
  const start = process.hrtime.bigint();
  await getDb().command({ ping: 1 });
  return Number(process.hrtime.bigint() - start) / 1e6; // ms
}

async function withTransaction(fn) {
  const session = client.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function close() {
  await client.close();
  db = null;
  connectPromise = null;
}

module.exports = { connect, getDb, getCollection, withTransaction, close, ping, client };
