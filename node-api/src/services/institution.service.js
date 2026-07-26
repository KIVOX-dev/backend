const BaseService = require('./BaseService');
const institutionRepository = require('../repositories/institution.repository');
const departmentRepository = require('../repositories/department.repository');
const ApiError = require('../utils/ApiError');

class InstitutionService extends BaseService {
  constructor() {
    super(institutionRepository, { entityName: 'Institution' });
  }

  // Public, unauthenticated (ported from python-service's GET /colleges) — used
  // by registration flows to populate an institution picker before the caller
  // has an account. Minimal fields only; the full record comes from the
  // authenticated list/getById routes.
  async listPublic() {
    const institutions = await institutionRepository.findActiveSortedByName();
    return institutions.map(({ id, name, code }) => ({ id, name, code }));
  }

  async getOwn(actor) {
    if (!actor.institutionId) throw ApiError.notFound('No institution linked to this account');
    return this.getById(actor.institutionId);
  }

  // Ported from python-service's colleges.py: creating an institution can
  // cascade-create its initial department roster in the same call.
  async create(data) {
    const { departments, ...institutionData } = data;
    const institution = await super.create(institutionData);
    if (Array.isArray(departments) && departments.length > 0) {
      await Promise.all(
        departments.map((dept) => departmentRepository.create({ institution_id: institution.id, ...dept }))
      );
    }
    return institution;
  }
}

module.exports = new InstitutionService();
