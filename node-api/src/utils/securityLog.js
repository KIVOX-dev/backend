const crypto = require('crypto');
const env = require('../config/env');
const logger = require('./logger');
const { currentRequest } = require('../middlewares/requestId');

// Security audit events: authentication, access control, privilege changes,
// deletions, admin actions. Each is one structured log line tagged
// logType="security", so Cloud Logging can route, retain, and alert on them
// (see deploy/terraform/logging). Distinct from recordActivity (the
// user-facing activity feed in MongoDB): these lines are the CERT-In audit
// record and never contain passwords, tokens, or raw personal data —
// utils/logRedaction.js enforces that on top of what callers pass.
//
// `alert` names the alert policy an event feeds, so alert filters match one
// field instead of a hand-maintained list of event names.
const EVENTS = Object.freeze({
  LOGIN_SUCCEEDED: { name: 'auth.login_succeeded', level: 'info' },
  LOGIN_FAILED: { name: 'auth.login_failed', level: 'warn', alert: 'failed_login' },
  REGISTERED: { name: 'auth.registered', level: 'info' },
  REFRESH_FAILED: { name: 'auth.refresh_failed', level: 'warn' },
  PASSWORD_RESET_REQUESTED: { name: 'auth.password_reset_requested', level: 'info' },
  PASSWORD_RESET_COMPLETED: { name: 'auth.password_reset_completed', level: 'info' },
  PASSWORD_CHANGED: { name: 'auth.password_changed', level: 'info' },
  EMAIL_VERIFIED: { name: 'auth.email_verified', level: 'info' },
  SIGN_IN_METHOD_LINKED: { name: 'auth.sign_in_method_linked', level: 'info' },
  SIGN_IN_METHOD_UNLINKED: { name: 'auth.sign_in_method_unlinked', level: 'info' },
  AUTH_RATE_LIMITED: { name: 'auth.rate_limited', level: 'warn', alert: 'failed_login' },
  RATE_LIMITED: { name: 'request.rate_limited', level: 'warn' },
  ACCESS_DENIED: { name: 'access.denied', level: 'warn' },
  USER_CREATED: { name: 'user.created', level: 'info' },
  ROLE_CHANGED: { name: 'user.role_changed', level: 'warn', alert: 'privilege_change' },
  STATUS_CHANGED: { name: 'user.status_changed', level: 'info' },
  USER_DELETED: { name: 'user.deleted', level: 'warn' },
  RECORD_DELETED: { name: 'record.deleted', level: 'info' },
  DOCUMENT_ACCESS_GRANTED: { name: 'document.access_granted', level: 'info' },
  ADMIN_ACTION: { name: 'admin.action', level: 'info' },
});

const PRIVILEGED_ROLES = new Set(['super_admin', 'institution_admin']);

// A stable pseudonym for an email address: lets an investigator see that 50
// failed logins all targeted the same account without the log ever holding
// the address itself. Keyed (HMAC), so it can't be reversed by hashing a
// list of known emails.
const PSEUDONYM_KEY = crypto.createHash('sha256').update(`${env.jwt.secret}:log-pseudonym`).digest();
function pseudonymize(value) {
  if (!value) return null;
  return crypto.createHmac('sha256', PSEUDONYM_KEY).update(String(value).trim().toLowerCase()).digest('hex').slice(0, 16);
}

function securityEvent(event, details = {}, req = currentRequest()) {
  const { actorId, actorRole, ...rest } = details;
  const alert = event.alert
    || (event === EVENTS.USER_CREATED && PRIVILEGED_ROLES.has(details.role) ? 'privilege_change' : undefined);
  logger.log(event.level, 'security_event', {
    logType: 'security',
    event: event.name,
    ...(alert ? { alert } : {}),
    actorId: actorId ?? req?.user?.id ?? null,
    actorRole: actorRole ?? req?.user?.role ?? null,
    ip: req?.ip ?? null,
    requestId: req?.id ?? null,
    userAgent: req?.get?.('user-agent')?.slice(0, 200) ?? null,
    ...rest,
  });
}

module.exports = { securityEvent, pseudonymize, EVENTS };
