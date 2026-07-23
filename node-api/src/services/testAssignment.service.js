const BaseService = require('./BaseService');
const testAssignmentRepository = require('../repositories/testAssignment.repository');
const studentRepository = require('../repositories/student.repository');
const { ROLES } = require('../config/constants');

class TestAssignmentService extends BaseService {
  constructor() {
    super(testAssignmentRepository, { entityName: 'Test assignment' });
  }

  async list(queryParams, actor) {
    const extraFilters = {};
    if (actor.role === ROLES.STUDENT) {
      const student = await studentRepository.findByUserId(actor.id);
      extraFilters.student_id = student ? student.id : null;
    }
    return super.list(queryParams, extraFilters);
  }

  async create(data, actor) {
    return this.repository.create({ ...data, assigned_by: actor.id });
  }
}

module.exports = new TestAssignmentService();
