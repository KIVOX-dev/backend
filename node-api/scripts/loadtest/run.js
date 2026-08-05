// Self-contained capacity benchmark: spins up an in-memory MongoDB
// (mongodb-memory-server — same tool the integration test suite already
// uses, no real network/Atlas involved), boots the real Express app against
// it with rate limits raised out of the way, seeds one user, mints a valid
// access token, then fires concurrent HTTP requests at a few representative
// endpoints and reports throughput/latency/status-code breakdown.
//
// Usage: node scripts/loadtest/run.js [--requests 6000] [--concurrency 150]
const http = require('http');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 ? Number(args[i + 1]) : def;
  };
  return {
    requestsPerEndpoint: get('--requests', 6000),
    concurrency: get('--concurrency', 150),
  };
}

async function setupServer() {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB_NAME = 'loadtest_upscaler_ai_node';
  process.env.JWT_SECRET = 'loadtest-jwt-secret';
  process.env.JWT_REFRESH_SECRET = 'loadtest-jwt-refresh-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  process.env.NODE_ENV = 'production';
  // Raised for this benchmark run only — never touches real .env.node /
  // production config. Point is to measure the app+DB, not re-discover the
  // rate limiter (already root-caused: see RATE_LIMIT_MAX default of 300).
  process.env.RATE_LIMIT_MAX = '100000000';
  process.env.AUTH_RATE_LIMIT_MAX = '100000000';
  process.env.IDENTIFY_RATE_LIMIT_MAX = '100000000';

  const projectRoot = path.join(__dirname, '..', '..');
  const database = require(path.join(projectRoot, 'src/config/database'));
  await database.connect();
  // Per-request logging would otherwise drown the benchmark's own summary in
  // tens of thousands of log lines — silenced for this run only.
  require(path.join(projectRoot, 'src/utils/logger')).silent = true;
  const app = require(path.join(projectRoot, 'src/app'));
  const userRepository = require(path.join(projectRoot, 'src/repositories/user.repository'));
  const { hashPassword } = require(path.join(projectRoot, 'src/utils/password'));
  const { signAccessToken } = require(path.join(projectRoot, 'src/utils/jwt'));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const password_hash = await hashPassword('Sup3rSecret!');
  const user = await userRepository.create({
    email: 'loadtest@example.com',
    password_hash,
    full_name: 'Load Test User',
    role: 'student',
    institution_id: null,
    status: 'approved',
    is_active: true,
    token_version: 0,
  });

  const token = signAccessToken({ sub: user.id, role: user.role, institutionId: user.institution_id, tv: 0 });

  return { mongod, database, server, port, token };
}

function percentile(sortedLatencies, p) {
  if (sortedLatencies.length === 0) return 0;
  const idx = Math.min(sortedLatencies.length - 1, Math.ceil((p / 100) * sortedLatencies.length) - 1);
  return sortedLatencies[idx];
}

function runBenchmark({ host, port, path: reqPath, headers, total, concurrency }) {
  return new Promise((resolve) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
    const latencies = [];
    const statusCounts = {};
    let sent = 0;
    let completed = 0;
    const start = process.hrtime.bigint();

    function fireOne() {
      if (sent >= total) return;
      sent += 1;
      const reqStart = process.hrtime.bigint();
      const req = http.request(
        { host, port, path: reqPath, method: 'GET', headers, agent, timeout: 10000 },
        (res) => {
          res.resume(); // drain body, we only care about status + timing
          res.on('end', () => {
            const ms = Number(process.hrtime.bigint() - reqStart) / 1e6;
            latencies.push(ms);
            statusCounts[res.statusCode] = (statusCounts[res.statusCode] || 0) + 1;
            completed += 1;
            if (sent < total) fireOne();
            else if (completed === total) finish();
          });
        }
      );
      req.on('error', () => {
        statusCounts.ERR = (statusCounts.ERR || 0) + 1;
        completed += 1;
        if (sent < total) fireOne();
        else if (completed === total) finish();
      });
      req.on('timeout', () => req.destroy());
      req.end();
    }

    function finish() {
      const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
      latencies.sort((a, b) => a - b);
      agent.destroy();
      resolve({
        totalMs,
        statusCounts,
        avg: latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1),
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        max: latencies[latencies.length - 1] || 0,
        rps: (total / totalMs) * 1000,
      });
    }

    for (let i = 0; i < Math.min(concurrency, total); i++) fireOne();
  });
}

function report(name, r, total) {
  const ok2xx = Object.entries(r.statusCounts)
    .filter(([code]) => code[0] === '2')
    .reduce((sum, [, n]) => sum + n, 0);
  console.log(`\n=== ${name} ===`);
  console.log(`  requests:     ${total}`);
  console.log(`  duration:     ${(r.totalMs / 1000).toFixed(2)}s`);
  console.log(`  throughput:   ${r.rps.toFixed(0)} req/s`);
  console.log(`  success 2xx:  ${ok2xx} (${((ok2xx / total) * 100).toFixed(1)}%)`);
  console.log(`  status codes: ${JSON.stringify(r.statusCounts)}`);
  console.log(`  latency avg:  ${r.avg.toFixed(2)}ms  p50: ${r.p50.toFixed(2)}ms  p95: ${r.p95.toFixed(2)}ms  p99: ${r.p99.toFixed(2)}ms  max: ${r.max.toFixed(2)}ms`);
}

async function main() {
  const { requestsPerEndpoint, concurrency } = parseArgs();
  console.log(`Booting ephemeral server (in-memory Mongo, rate limits raised for this run only)...`);
  const { mongod, database, server, port, token } = await setupServer();
  console.log(`Server up on 127.0.0.1:${port}. Running ${requestsPerEndpoint} requests/endpoint at concurrency ${concurrency}.`);

  try {
    const targets = [
      { name: 'GET /health (no auth, no DB)', path: '/health', headers: {} },
      { name: 'GET /health/ready (real Mongo round-trip)', path: '/health/ready', headers: {} },
      { name: 'GET /api/v1/auth/me (JWT verify + DB read)', path: '/api/v1/auth/me', headers: { Authorization: `Bearer ${token}` } },
    ];

    for (const t of targets) {
      const r = await runBenchmark({
        host: '127.0.0.1',
        port,
        path: t.path,
        headers: t.headers,
        total: requestsPerEndpoint,
        concurrency,
      });
      report(t.name, r, requestsPerEndpoint);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await database.close();
    await mongod.stop();
  }
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
