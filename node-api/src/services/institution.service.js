const BaseService = require('./BaseService');
const institutionRepository = require('../repositories/institution.repository');
const departmentRepository = require('../repositories/department.repository');
const ApiError = require('../utils/ApiError');
const { getDepartmentNames, codeFor, uniqueCode } = require('../utils/departmentCatalog');

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
  //
  // When the caller doesn't supply an explicit list, auto-seed the full
  // catalog instead of leaving the institution with zero departments —
  // this used to be a manual, easy-to-forget step (scripts/seedDepartments.js,
  // run by hand against production after the fact), which is exactly what
  // silently broke Assign Test's department picker, the faculty batch-
  // upload's Default Department dropdown, and everything else that reads
  // from this collection for any institution created without someone
  // remembering to re-run that script.
  async create(data) {
    const { departments, ...institutionData } = data;
    const institution = await super.create(institutionData);

    if (Array.isArray(departments) && departments.length > 0) {
      await Promise.all(
        departments.map((dept) => departmentRepository.create({ institution_id: institution.id, ...dept }))
      );
    } else {
      const usedCodes = new Set();
      for (const name of getDepartmentNames(institution.name)) {
        const code = uniqueCode(codeFor(name), usedCodes);
        usedCodes.add(code);
        await departmentRepository.create({ institution_id: institution.id, name, code });
      }
    }

    return institution;
  }
}

module.exports = new InstitutionService();
