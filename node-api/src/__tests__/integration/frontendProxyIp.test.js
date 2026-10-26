const request = require('supertest');
const express = require('express');
const env = require('../../config/env');
const frontendProxyIp = require('../../middlewares/frontendProxyIp');

// A tiny app that echoes the address Express settles on, with the same
// trust-proxy setting as the real one.
function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(frontendProxyIp);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  return app;
}

describe('frontendProxyIp', () => {
  const original = env.frontendProxy.secret;
  afterEach(() => {
    env.frontendProxy.secret = original;
  });

  it('believes the forwarded visitor IP only when the shared secret matches', async () => {
    env.frontendProxy.secret = 's3cret-value';
    const app = buildApp();

    const ok = await request(app).get('/ip').set('x-ts-proxy-secret', 's3cret-value').set('x-ts-client-ip', '203.0.113.9');
    expect(ok.body.ip).toBe('203.0.113.9');

    const wrong = await request(app).get('/ip').set('x-ts-proxy-secret', 'guess').set('x-ts-client-ip', '203.0.113.9');
    expect(wrong.body.ip).not.toBe('203.0.113.9');

    const noSecret = await request(app).get('/ip').set('x-ts-client-ip', '203.0.113.9');
    expect(noSecret.body.ip).not.toBe('203.0.113.9');
  });

  it('ignores a malformed IP even with the right secret', async () => {
    env.frontendProxy.secret = 's3cret-value';
    const res = await request(buildApp()).get('/ip').set('x-ts-proxy-secret', 's3cret-value').set('x-ts-client-ip', 'not-an-ip');
    expect(res.body.ip).not.toBe('not-an-ip');
  });

  it('does nothing when no secret is configured, so the header can never be used to spoof an address', async () => {
    env.frontendProxy.secret = null;
    const res = await request(buildApp()).get('/ip').set('x-ts-proxy-secret', 'anything').set('x-ts-client-ip', '203.0.113.9');
    expect(res.body.ip).not.toBe('203.0.113.9');
  });
});
