const BaseService = require('./BaseService');
const departmentRepository = require('../repositories/department.repository');
const { ROLES } = require('../config/constants');

class DepartmentService extends BaseService {
  constructor() {
    super(departmentRepository, { entityName: 'Department' });
  }

  // Overrides BaseService's paginated default (20/page, 100 cap) — a
  // college can have 150+ real departments, and every consumer of GET
  // /departments wants the complete list (a dropdown or chip display), not
  // a browsable page. Institution scoping is applied here from `actor`
  // directly (not from queryParams.institution_id) — matching
  // student.service.js/user.service.js's established pattern — since
  // req.query can no longer be relied on as a mutation side-channel under
  // Express 5 (see middlewares/scopeInstitution.js).
  async list(queryParams, actor) {
    const { page, limit, ...filters } = queryParams;
    if (actor.role !== ROLES.SUPER_ADMIN) filters.institution_id = actor.institutionId;
    const rows = await departmentRepository.findAllUnpaginated(filters);
    return { rows, meta: { page: 1, limit: rows.length, total: rows.length } };
  }

  // Public (see institution.routes.js) — backs the College -> Department
  // picker on student profile completion, which must work for ANY college
  // the student picks, not just their own (they may not have one set yet).
  listByInstitution(institutionId) {
    return departmentRepository.findByInstitutionId(institutionId);
  }
}

module.exports = new DepartmentService();
