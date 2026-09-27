const winston = require('winston');

// Scrubs secrets and personal data from every log entry before it's written.
// Applied inside the logger itself (utils/logger.js), so a careless
// `logger.info('...', { body: req.body })` anywhere in the codebase still
// can't put a password, token, or raw email address into Cloud Logging —
// logs are retained for a year and read by more people than the database.

// Values under these keys are dropped entirely, at any depth.
const SECRET_KEY = /password|passwd|passphrase|^pass$|token|secret|authorization|cookie|api[-_]?key|^otp$|totp|recovery[-_]?codes?|signature|credential/i;

// Values under these keys are personal data: masked, not dropped, so a log
// line still shows *that* a value was present and roughly what it was.
const PERSONAL_KEYS = new Set([
  'email', 'to', 'phone', 'full_name', 'fullName', 'name', 'address',
  'date_of_birth', 'dob', 'roll_number', 'rollNumber', 'google_email', 'linkedin_email',
]);

// Also caught inside free-text strings (messages, error text), where no key
// name gives them away.
const EMAIL_PATTERN = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
// Signed-link credentials in any logged URL (placement proofs, profile media,
// GCS V4 signatures, legacy WebSocket ?token=).
const URL_SECRET_PARAM = /([?&](?:token|sig|signature|X-Goog-Signature|X-Goog-Credential)=)[^&\s"]+/gi;

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;

function maskString(value) {
  return value
    .replace(JWT_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(URL_SECRET_PARAM, `$1${REDACTED}`)
    .replace(EMAIL_PATTERN, '$1***@$2');
}

function maskPersonal(value) {
  if (typeof value !== 'string') return value == null ? value : '[MASKED]';
  if (value.includes('@')) return maskString(value);
  if (value.length <= 2) return '***';
  return `${value[0]}***${value[value.length - 1]}`;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactValue(value, depth) {
  if (typeof value === 'string') return maskString(value);
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value instanceof Error) return maskString(value.message);
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) out[key] = REDACTED;
      else if (PERSONAL_KEYS.has(key)) out[key] = maskPersonal(child);
      else out[key] = redactValue(child, depth + 1);
    }
    return out;
  }
  return value;
}

// Winston keeps level/message on the info object itself (plus Symbol-keyed
// internals, which Object.entries skips and must survive untouched).
const redact = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'timestamp') continue;
    if (key === 'message' || key === 'stack') {
      if (typeof info[key] === 'string') info[key] = maskString(info[key]);
    } else if (SECRET_KEY.test(key)) {
      info[key] = REDACTED;
    } else if (PERSONAL_KEYS.has(key)) {
      info[key] = maskPersonal(info[key]);
    } else {
      info[key] = redactValue(info[key], 0);
    }
  }
  return info;
});

// Cloud Logging reads `severity`, not winston's `level` — without this every
// entry lands as severity DEFAULT, so "show me errors" filters and
// severity-based alerts match nothing.
const SEVERITY = { error: 'ERROR', warn: 'WARNING', info: 'INFO', http: 'INFO', verbose: 'DEBUG', debug: 'DEBUG', silly: 'DEBUG' };
const cloudSeverity = winston.format((info) => {
  info.severity = SEVERITY[info.level] || 'DEFAULT';
  return info;
});

module.exports = { redact, cloudSeverity, maskString, REDACTED };
