module.exports = {
  // Jest's default testMatch treats every .js file under __tests__/ as a
  // test file, which picks up __tests__/helpers/*.js (shared test utilities,
  // no tests of their own) and fails the run ("must contain at least one
  // test"). Scope it to *.test.js explicitly instead.
  testMatch: ['**/*.test.js'],
  // Each integration test file boots its own mongodb-memory-server instance
  // (a real mongod process — see __tests__/helpers/testApp.js). Running many
  // of those at once contends for CPU/IO badly enough to blow past Jest's
  // default 5s per-hook timeout; capping worker concurrency and raising the
  // timeout keeps the suite reliable both locally and in CI.
  maxWorkers: 2,
  testTimeout: 30000,
};
