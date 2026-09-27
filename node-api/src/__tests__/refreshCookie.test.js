// The production refresh cookie must reach the API from www.talentsnaps.com
// while the API lives on a different site (*.run.app): SameSite=None, Secure,
// Partitioned. SameSite=Strict there logged everyone out on reload/new tab.
const express = require('express');
const request = require('supertest');

function appFor(nodeEnv) {
  jest.resetModules();
  process.env.NODE_ENV = nodeEnv;
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/unused';
  process.env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret';
  const { setRefreshCookie } = require('../utils/refreshCookie');
  const { signRefreshToken } = require('../utils/jwt');
  const app = express();
  app.get('/', (req, res) => {
    setRefreshCookie(res, signRefreshToken({ sub: 'u1', tv: 0 }));
    res.end();
  });
  return app;
}

afterAll(() => {
  process.env.NODE_ENV = 'test';
});

it('is SameSite=None; Secure; Partitioned; HttpOnly in production', async () => {
  const res = await request(appFor('production')).get('/');
  const cookie = res.headers['set-cookie'][0];
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/SameSite=None/i);
  expect(cookie).toMatch(/Partitioned/i);
  expect(cookie).toMatch(/Expires=/i);
});

it('stays SameSite=Strict without Secure in development', async () => {
  const res = await request(appFor('development')).get('/');
  const cookie = res.headers['set-cookie'][0];
  expect(cookie).toMatch(/SameSite=Strict/i);
  expect(cookie).not.toMatch(/Secure/i);
});
