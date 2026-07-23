const BaseService = require('./BaseService');
const testRepository = require('../repositories/test.repository');
const { ROLES } = require('../config/constants');

class TestService extends BaseService {
  constructor() {
    super(testRepository, { entityName: 'Test' });
  }

  async create(data, actor) {
    const payload = { ...data, created_by: actor.id };
    if (actor.role === ROLES.FACULTY || actor.role === ROLES.INSTITUTION_ADMIN) {
      payload.institution_id = actor.institutionId;
    }
    return this.repository.create(payload);
  }
}

module.exports = new TestService();
