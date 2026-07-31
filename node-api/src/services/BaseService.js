const ApiError = require('../utils/ApiError');
const { assertInstitutionOwnership } = require('../utils/authz');

// Generic service shared by every entity module. Entity-specific services extend this
// and override/add methods for anything beyond plain CRUD (see authService, placementService).
class BaseService {
  constructor(repository, { entityName = 'Resource' } = {}) {
    this.repository = repository;
    this.entityName = entityName;
  }

  async list(queryParams = {}, extraFilters = {}) {
    const { page: pageParam, limit: limitParam, ...filterParams } = queryParams;
    const page = Math.max(parseInt(pageParam, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitParam, 10) || 20, 1), 100);
    const filters = { ...filterParams, ...extraFilters };
    const { rows, total } = await this.repository.findAll({ page, limit, filters });
    return { rows, meta: { page, limit, total } };
  }

  async getById(id, actor) {
    const item = await this.repository.findById(id);
    if (!item) throw ApiError.notFound(`${this.entityName} not found`);
    if (actor) assertInstitutionOwnership(actor, item);
    return item;
  }

  async create(data) {
    return this.repository.create(data);
  }

  async update(id, data, actor) {
    if (actor) {
      const existing = await this.repository.findById(id);
      if (!existing) throw ApiError.notFound(`${this.entityName} not found`);
      assertInstitutionOwnership(actor, existing);
    }
    const updated = await this.repository.updateById(id, data);
    if (!updated) throw ApiError.notFound(`${this.entityName} not found`);
    return updated;
  }

  async remove(id, actor) {
    if (actor) {
      const existing = await this.repository.findById(id);
      if (!existing) throw ApiError.notFound(`${this.entityName} not found`);
      assertInstitutionOwnership(actor, existing);
    }
    const deleted = await this.repository.deleteById(id);
    if (!deleted) throw ApiError.notFound(`${this.entityName} not found`);
  }
}

module.exports = BaseService;
