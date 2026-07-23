const BaseService = require('./BaseService');
const placementRepository = require('../repositories/placement.repository');
const { ROLES } = require('../config/constants');

class PlacementService extends BaseService {
  constructor() {
    super(placementRepository, { entityName: 'Placement' });
  }

  // created_by is always the authenticated caller — never trust a client-supplied value here.
  // institution_admin cannot post a drive under a different institution than their own.
  async create(data, actor) {
    const payload = { ...data, created_by: actor.id };
    if (actor.role === ROLES.INSTITUTION_ADMIN) {
      payload.institution_id = actor.institutionId;
    }
    return this.repository.create(payload);
  }
}

module.exports = new PlacementService();
