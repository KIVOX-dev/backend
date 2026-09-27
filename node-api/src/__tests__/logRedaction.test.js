const { Writable } = require('stream');

// Exercises the real application logger (utils/logger.js) end to end: every
// assertion is against the exact JSON line that would reach Cloud Logging.
function loadLogger() {
  jest.resetModules();
  const winston = require('winston');
  const logger = require('../utils/logger');
  const lines = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });
  logger.clear();
  logger.add(new winston.transports.Stream({ stream }));
  return { logger, lines };
}

describe('log redaction', () => {
  let logger;
  let lines;
  beforeEach(() => {
    ({ logger, lines } = loadLogger());
  });

  it('drops secrets at any depth', () => {
    logger.info('login attempt', {
      password: 'hunter2',
      body: { newPassword: 'x', refreshToken: 'abc', nested: { client_secret: 's', apiKey: 'k' } },
      headers: { authorization: 'Bearer abc.def.ghi', cookie: 'sid=1' },
    });
    const [line] = lines;
    expect(line.password).toBe('[REDACTED]');
    expect(line.body.newPassword).toBe('[REDACTED]');
    expect(line.body.refreshToken).toBe('[REDACTED]');
    expect(line.body.nested).toEqual({ client_secret: '[REDACTED]', apiKey: '[REDACTED]' });
    expect(line.headers).toEqual({ authorization: '[REDACTED]', cookie: '[REDACTED]' });
    expect(JSON.stringify(line)).not.toMatch(/hunter2|abc\.def/);
  });

  it('masks personal data under known keys', () => {
    logger.info('email sent', { to: 'jane.doe@example.com', phone: '9876543210', rollNumber: 'CS2024001' });
    const [line] = lines;
    expect(line.to).toBe('j***@example.com');
    expect(line.phone).toBe('9***0');
    expect(line.rollNumber).toBe('C***1');
  });

  it('masks emails, JWTs, bearer tokens and signed-link params inside free text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';
    logger.error(`failed for bob@corp.in with ${jwt}; Bearer ${jwt}; GET /uploads/profile/a.png?token=SECRET123&exp=99`);
    const { message } = lines[0];
    expect(message).toContain('b***@corp.in');
    expect(message).not.toContain('bob@');
    expect(message).not.toContain(jwt);
    expect(message).not.toContain('SECRET123');
    expect(message).toContain('exp=99');
  });

  it('leaves ordinary fields alone and maps level to Cloud Logging severity', () => {
    logger.warn('request', { statusCode: 403, code: 'FORBIDDEN', userId: 'u-1', path: '/api/v1/users' });
    const [line] = lines;
    expect(line).toMatchObject({ level: 'warn', severity: 'WARNING', statusCode: 403, code: 'FORBIDDEN', userId: 'u-1', path: '/api/v1/users' });
    expect(line.timestamp).toMatch(/Z$/);
  });
});

describe('request id', () => {
  const requestId = require('../middlewares/requestId');

  function run(header) {
    const req = { headers: header === undefined ? {} : { 'x-request-id': header } };
    const res = { set: jest.fn() };
    requestId(req, res, () => {});
    return req.id;
  }

  it('keeps a safe inbound id', () => {
    expect(run('lb-abc_123:1')).toBe('lb-abc_123:1');
  });

  it.each([
    ['newline injection', 'abc\n{"event":"auth.login_succeeded"}'],
    ['an oversized value', 'a'.repeat(500)],
    ['spaces', 'a b'],
  ])('replaces %s with a generated id', (_label, value) => {
    expect(run(value)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
