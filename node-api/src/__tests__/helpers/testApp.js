// Shared integration-test harness: spins up an in-memory MongoDB instance
// (mongodb-memory-server — no real database/network needed) and a fresh
// Express app wired to it. env.js/database.js read process.env at require
// time, so every env var below must be set *before* app.js is required —
// jest.resetModules() ensures each caller gets a clean module registry
// rather than reusing whatever a previous test file's require() cached.
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

async function buildTestApp() {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = 'test_upscaler_ai_node';
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  process.env.NODE_ENV = 'test';
  // High enough that a single test file's requests never trip the general
  // limiter — auth-specific endpoints keep their own tighter limiter
  // (20/15min) intentionally, so auth tests stay under that per file.
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.AUTH_RATE_LIMIT_MAX = '1000';

  jest.resetModules();
  const database = require('../../config/database');
  await database.connect();
  const app = require('../../app');

  // Same module registry as `app` above (both loaded after the
  // jest.resetModules() call) — required here rather than re-required per
  // test file so seeding writes to the same in-memory DB connection the
  // app itself uses, not a second, disconnected instance.
  const userRepository = require('../../repositories/user.repository');
  const institutionRepository = require('../../repositories/institution.repository');
  const studentRepository = require('../../repositories/student.repository');
  const { hashPassword } = require('../../utils/password');

  return { app, database, userRepository, institutionRepository, studentRepository, hashPassword };
}

async function teardownTestApp(database) {
  if (database) await database.close();
  if (mongod) await mongod.stop();
}

module.exports = { buildTestApp, teardownTestApp };
