const env = require('../config/env');
const { ROLES } = require('../config/constants');
const { securityEvent, EVENTS } = require('../utils/securityLog');

// One `admin.action` security event per state-changing request made by a
// staff account (anyone who can act on other people's data), whatever the
// route — so a new admin endpoint is audited from day one without anyone
// remembering to add logging to it. Records what was done and to which
// record ids, never the request body. Auth routes are skipped: they have
// their own, more specific events (utils/securityLog.js).
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const STAFF_ROLES = new Set([ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.HR, ROLES.FACULTY]);
const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const AUTH_PREFIX = `${env.apiPrefix}/auth`;

module.exports = function auditStaffActions(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();

  res.on('finish', () => {
    // req.user is set by authenticate, which runs later than this middleware
    // — by the time the response finishes, it's there if the caller was
    // signed in at all.
    if (!req.user || !STAFF_ROLES.has(req.user.role)) return;
    const path = req.originalUrl.split('?')[0];
    if (path.startsWith(AUTH_PREFIX)) return;

    securityEvent(EVENTS.ADMIN_ACTION, {
      method: req.method,
      route: path.replace(UUID_SEGMENT, '/:id'),
      targetIds: (path.match(UUID_SEGMENT) || []).map((segment) => segment.slice(1)),
      statusCode: res.statusCode,
      outcome: res.statusCode < 400 ? 'success' : 'failure',
    }, req);
  });
  next();
};
