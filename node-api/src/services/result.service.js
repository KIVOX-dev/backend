const BaseService = require('./BaseService');
const resultRepository = require('../repositories/result.repository');
const testAssignmentRepository = require('../repositories/testAssignment.repository');
const studentRepository = require('../repositories/student.repository');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');

class ResultService extends BaseService {
  constructor() {
    super(resultRepository, { entityName: 'Result' });
  }

  async list(queryParams, actor) {
    const extraFilters = {};
    if (actor.role === ROLES.STUDENT) {
      const student = await studentRepository.findByUserId(actor.id);
      extraFilters.student_id = student ? student.id : null;
    }
    return super.list(queryParams, extraFilters);
  }

  // student_id/test_id are always derived from the referenced test_assignment row,
  // never accepted from the request — this keeps a result physically impossible to
  // record against a mismatched student/test pair.
  async create(data) {
    const assignment = await testAssignmentRepository.findById(data.test_assignment_id);
    if (!assignment) throw ApiError.badRequest('test_assignment_id does not reference a valid assignment');

    // The old Postgres schema computed this as a GENERATED ALWAYS column — Mongo has no
    // equivalent, so it's computed here, once, at write time instead of on every read.
    const percentage = Math.round((data.marks_obtained / data.total_marks) * 100 * 100) / 100;

    const result = await this.repository.create({
      test_assignment_id: assignment.id,
      student_id: assignment.student_id,
      test_id: assignment.test_id,
      marks_obtained: data.marks_obtained,
      total_marks: data.total_marks,
      percentage,
    });

    await testAssignmentRepository.updateById(assignment.id, { status: 'completed' });
    return result;
  }
}

module.exports = new ResultService();
