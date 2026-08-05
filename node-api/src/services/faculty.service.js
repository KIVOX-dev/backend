const BaseService = require('./BaseService');
const facultyRepository = require('../repositories/faculty.repository');
const { ROLES } = require('../config/constants');

class FacultyService extends BaseService {
  constructor() {
    super(facultyRepository, { entityName: 'Faculty profile' });
  }

  // Institution scoping applied from `actor` directly, not from
  // queryParams.institution_id — req.query can no longer be relied on as a
  // mutation side-channel under Express 5 (see middlewares/scopeInstitution.js).
  // Without this override, GET /faculty used the raw BaseService.list() with
  // no extraFilters at all, which silently returned every institution's
  // faculty rows to any authenticated caller.
  async list(queryParams, actor) {
    const extraFilters = actor.role === ROLES.SUPER_ADMIN ? {} : { institution_id: actor.institutionId };
    return super.list(queryParams, extraFilters);
  }
}

module.exports = new FacultyService();
