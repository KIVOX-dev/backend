const BaseService = require('./BaseService');
const collegeAdminRepository = require('../repositories/collegeAdmin.repository');
const { ROLES } = require('../config/constants');

class CollegeAdminService extends BaseService {
  constructor() {
    super(collegeAdminRepository, { entityName: 'College admin' });
  }

  // Institution scoping applied from `actor` directly, not from
  // queryParams.institution_id — req.query can no longer be relied on as a
  // mutation side-channel under Express 5 (see middlewares/scopeInstitution.js).
  // Without this override, GET /college-admins used the raw BaseService.list()
  // with no extraFilters at all, which silently returned every institution's
  // college-admin rows to any authenticated caller.
  async list(queryParams, actor) {
    const extraFilters = actor.role === ROLES.SUPER_ADMIN ? {} : { institution_id: actor.institutionId };
    return super.list(queryParams, extraFilters);
  }
}

module.exports = new CollegeAdminService();
