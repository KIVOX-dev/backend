const profileDataRepository = require('../repositories/profileData.repository');
const { SCHEMAS, portalForRole } = require('../config/onboardingSchemas');
const ApiError = require('../utils/ApiError');

function requirePortal(actor) {
  const portal = portalForRole(actor.role);
  if (!portal) throw ApiError.badRequest(`No onboarding profile exists for role '${actor.role}'`);
  return portal;
}

class ProfileService {
  getSchema(actor) {
    return SCHEMAS[requirePortal(actor)];
  }

  async getOwn(actor) {
    const portal = requirePortal(actor);
    const record = await profileDataRepository.findByUserId(actor.id);
    return { exists: Boolean(record), portal, google: null, values: record ? record.values : {} };
  }

  // Full overwrite, no merge — matches python-service exactly. `values` is
  // already a flat object of text fields + uploaded-file public paths by the
  // time it reaches here (see profile.controller.js, which does the
  // multer/JSON reconciliation — an HTTP-layer concern, not a service one).
  async saveOwn(actor, values) {
    const portal = requirePortal(actor);
    const existing = await profileDataRepository.findByUserId(actor.id);
    if (existing) {
      await profileDataRepository.updateById(existing.id, { portal, values });
    } else {
      await profileDataRepository.create({ user_id: actor.id, portal, values });
    }
    return { exists: true, portal, google: null, values };
  }
}

module.exports = new ProfileService();
