const BaseService = require('./BaseService');
const departmentRepository = require('../repositories/department.repository');

class DepartmentService extends BaseService {
  constructor() {
    super(departmentRepository, { entityName: 'Department' });
  }

  // Public (see institution.routes.js) — backs the College -> Department
  // picker on student profile completion, which must work for ANY college
  // the student picks, not just their own (they may not have one set yet).
  listByInstitution(institutionId) {
    return departmentRepository.findByInstitutionId(institutionId);
  }
}

module.exports = new DepartmentService();
