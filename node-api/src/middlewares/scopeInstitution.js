// Multi-tenant guardrail: everyone except super_admin is confined to their own institution.
// Overwrites any client-supplied institution_id on create/update — a client can never claim a
// different tenant's institution_id, even if it sends one in the request body.
//
// Does NOT (and, as of Express 5, cannot) inject institution scoping into list queries via
// req.query — Express 5 made req.query a read-only getter re-derived from the URL on each
// access; assigning to it (`req.query.institution_id = ...`) is silently a no-op; a prior
// version of this file did exactly that; it worked under Express 4 and produced a real,
// silent cross-tenant data leak the moment this app moved to Express 5, caught by an
// integration test (department listing) rather than by anything in Express itself.
//
// Every list endpoint must instead scope itself explicitly from `actor.institutionId`
// (the authenticated req.user, always available downstream regardless of body/query
// parsing) — see student.service.js#list / user.service.js#list / department.service.js#list
// for the established pattern. This middleware still exists for the create/update
// body-forcing behavior below, which — unlike req.query — is unaffected by Express 5
// (req.body is a plain object populated once by the body-parser, not a live getter).
module.exports = function scopeInstitution(req, res, next) {
  if (req.user.role !== 'super_admin') {
    if (req.body && typeof req.body === 'object' && 'institution_id' in req.body) {
      req.body.institution_id = req.user.institutionId;
    }
  }
  next();
};
