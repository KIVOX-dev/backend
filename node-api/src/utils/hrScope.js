const hrRepository = require('../repositories/hr.repository');
const placementRepository = require('../repositories/placement.repository');
const { ROLES } = require('../config/constants');
const ApiError = require('./ApiError');

// An HR user's organisation is their company (hr profile company_id) when one
// is linked; otherwise the user is their own one-person organisation. Shared
// resources (talent pool, employees) are keyed by this id so colleagues at the
// same company see the same data. super_admin has no org (null = everything).
async function getOrgId(actor) {
  if (actor.role === ROLES.SUPER_ADMIN) return null;
  const profile = await hrRepository.findByUserId(actor.id);
  return (profile && profile.company_id) || actor.id;
}

// A placement belongs to an HR user when they posted it, or — if they're
// linked to a company — when it's posted under that company.
async function placementOwnerFilter(actor) {
  if (actor.role === ROLES.SUPER_ADMIN) return {};
  const profile = await hrRepository.findByUserId(actor.id);
  const or = [{ recruiter_id: actor.id }];
  if (profile && profile.company_id) or.push({ company_id: profile.company_id });
  return { $or: or };
}

async function ownsPlacement(actor, placement) {
  if (actor.role === ROLES.SUPER_ADMIN) return true;
  if (placement.recruiter_id === actor.id) return true;
  const profile = await hrRepository.findByUserId(actor.id);
  return Boolean(profile && profile.company_id && placement.company_id === profile.company_id);
}

// Loads a placement and asserts the HR actor may manage it. 404 for a missing
// one, 403 for someone else's.
async function loadOwnedPlacement(actor, placementId) {
  const placement = await placementRepository.findById(placementId);
  if (!placement) throw ApiError.notFound('Vacancy not found');
  if (!(await ownsPlacement(actor, placement))) throw ApiError.forbidden('This vacancy belongs to another recruiter');
  return placement;
}

// Ids of every placement the actor manages (for scoping application queries).
async function ownedPlacements(actor, projection = {}) {
  const filter = await placementOwnerFilter(actor);
  const docs = await placementRepository.collection.find(filter).project(projection).toArray();
  return docs.map((d) => placementRepository._toEntity(d));
}

module.exports = { getOrgId, placementOwnerFilter, ownsPlacement, loadOwnedPlacement, ownedPlacements };
