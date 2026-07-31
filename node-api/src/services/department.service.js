const BaseService = require('./BaseService');
const departmentRepository = require('../repositories/department.repository');

class DepartmentService extends BaseService {
  constructor() {
    super(departmentRepository, { entityName: 'Department' });
  }

  // Overrides BaseService's paginated default (20/page, 100 cap) — a
  // college can have 150+ real departments, and every consumer of GET
  // /departments wants the complete list (a dropdown or chip display), not
  // a browsable page. institution_id is already present in queryParams by
  // the time this runs (scopeInstitution injects it for non-super_admin).
  async list(queryParams) {
    const { page, limit, ...filters } = queryParams;
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
