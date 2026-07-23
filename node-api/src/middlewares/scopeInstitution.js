// Multi-tenant guardrail: everyone except super_admin is confined to their own institution.
// Forces list queries to filter by the caller's institution and overwrites any
// client-supplied institution_id on create/update — a client can never claim a
// different tenant's institution_id, even if it sends one in the request body.
module.exports = function scopeInstitution(req, res, next) {
  if (req.user.role !== 'super_admin') {
    req.query.institution_id = req.user.institutionId;
    if (req.body && typeof req.body === 'object' && 'institution_id' in req.body) {
      req.body.institution_id = req.user.institutionId;
    }
  }
  next();
};
