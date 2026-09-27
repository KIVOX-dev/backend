const { Writable } = require('stream');
const express = require('express');
const request = require('supertest');

// A 429 from the auth limiter is logged as auth.rate_limited, feeding the
// same failed_login alert as individual failed logins.
describe('rate limit security events', () => {
  let lines;
  let app;

  beforeAll(() => {
    jest.resetModules();
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/unused';
    process.env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret';
    process.env.AUTH_RATE_LIMIT_MAX = '2';
    delete process.env.REDIS_URL;

    const winston = require('winston');
    const logger = require('../utils/logger');
    lines = [];
    logger.add(new winston.transports.Stream({
      stream: new Writable({
        write(chunk, _encoding, callback) {
          lines.push(JSON.parse(chunk.toString()));
          callback();
        },
      }),
    }));

    const { authLimiter } = require('../middlewares/rateLimiter');
    const requestId = require('../middlewares/requestId');
    app = express();
    app.use(requestId);
    app.post('/api/v1/auth/login', authLimiter, (req, res) => res.status(401).json({ success: false }));
  });

  afterAll(() => {
    delete process.env.AUTH_RATE_LIMIT_MAX;
  });

  it('logs the request that trips the auth limiter', async () => {
    await request(app).post('/api/v1/auth/login').expect(401);
    await request(app).post('/api/v1/auth/login').expect(401);
    const res = await request(app).post('/api/v1/auth/login').expect(429);
    expect(res.body.message).toMatch(/Too many authentication attempts/);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const hits = lines.filter((l) => l.event === 'auth.rate_limited');
    expect(hits).toEqual([
      expect.objectContaining({ logType: 'security', limiter: 'auth', path: '/api/v1/auth/login', alert: 'failed_login', severity: 'WARNING' }),
    ]);
    expect(hits[0].ip).toBeTruthy();
  });
});
