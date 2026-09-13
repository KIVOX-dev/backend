// Ensures connection strings, tokens, and passwords never reach stdout/log files.
// Every logger.* call in this tool goes through here for any field that might
// contain a URI, and uncaught errors are sanitized before printing (driver
// errors sometimes embed the connection string in err.message).

const SENSITIVE_KEYS = /uri|token|password|secret|credential|authorization/i;

function redactString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/mongodb(\+srv)?:\/\/[^\s"']+/gi, 'mongodb://[REDACTED]')
    .replace(/(authMechanismProperties|TOKEN_RESOURCE)=[^\s&"']+/gi, '$1=[REDACTED]');
}

function redact(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(val);
    }
    return out;
  }
  return value;
}

function redactError(err) {
  if (!err) return err;
  return {
    name: err.name,
    message: redactString(err.message || String(err)),
    code: err.code,
  };
}

module.exports = { redact, redactError };
