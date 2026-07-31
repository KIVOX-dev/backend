const { ROLES } = require('../config/constants');
const ApiError = require('./ApiError');

function isSuperAdmin(actor) {
  return !!actor && actor.role === ROLES.SUPER_ADMIN;
}

// Institution-level ownership check for a fetched document. No-ops for
// entities that don't carry institution_id at all (institutions, companies,
// hr, activity logs, etc.) — nothing to enforce there. Always 403, never 404
// — a cross-tenant record exists, the caller just isn't allowed to see it.
function assertInstitutionOwnership(actor, doc) {
  if (!doc || isSuperAdmin(actor) || doc.institution_id === undefined) return;
  if (doc.institution_id !== actor.institutionId) {
    throw ApiError.forbidden('You do not have access to this resource');
  }
}

// For notifications and similar: verify a target user belongs to the
// actor's own institution before acting on their behalf.
function assertSameInstitution(actor, targetUser) {
  if (isSuperAdmin(actor)) return;
  if (!targetUser || targetUser.institution_id !== actor.institutionId) {
    throw ApiError.forbidden('You may only act on users within your own institution');
  }
}

// Merges an institution filter into `extra` for list-style queries — {} for
// super_admin (sees everything), otherwise scoped to the actor's own institution.
function buildInstitutionFilter(actor, extra = {}) {
  return isSuperAdmin(actor) ? { ...extra } : { institution_id: actor.institutionId, ...extra };
}

module.exports = { isSuperAdmin, assertInstitutionOwnership, assertSameInstitution, buildInstitutionFilter };
