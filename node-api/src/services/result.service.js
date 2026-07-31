const BaseService = require('./BaseService');
const resultRepository = require('../repositories/result.repository');
const testAssignmentRepository = require('../repositories/testAssignment.repository');
const studentRepository = require('../repositories/student.repository');
const { ROLES } = require('../config/constants');
const { buildInstitutionFilter } = require('../utils/authz');
const ApiError = require('../utils/ApiError');

class ResultService extends BaseService {
  constructor() {
    super(resultRepository, { entityName: 'Result' });
  }

  async list(queryParams, actor) {
    let extraFilters;
    if (actor.role === ROLES.STUDENT) {
      const student = await studentRepository.findByUserId(actor.id);
      extraFilters = { student_id: student ? student.id : null };
    } else {
      extraFilters = buildInstitutionFilter(actor);
    }
    return super.list(queryParams, extraFilters);
  }

  // See testAssignment.service.js#getById for why the row-level student check
  // is needed on top of the institution-level one.
  async getById(id, actor) {
    const item = await super.getById(id, actor);
    if (actor.role === ROLES.STUDENT) {
      const student = await studentRepository.findByUserId(actor.id);
      if (!student || item.student_id !== student.id) {
        throw ApiError.forbidden('You do not have access to this resource');
      }
    }
    return item;
  }

  // student_id/test_id/institution_id are always derived from the referenced test_assignment row,
  // never accepted from the request — this keeps a result physically impossible to
  // record against a mismatched student/test pair or the wrong institution.
  async create(data) {
    const assignment = await testAssignmentRepository.findById(data.test_assignment_id);
    if (!assignment) throw ApiError.badRequest('test_assignment_id does not reference a valid assignment');

    // The old Postgres schema computed this as a GENERATED ALWAYS column — Mongo has no
    // equivalent, so it's computed here, once, at write time instead of on every read.
    const percentage = Math.round((data.marks_obtained / data.total_marks) * 100 * 100) / 100;

    const result = await this.repository.create({
      test_assignment_id: assignment.id,
      student_id: assignment.student_id,
      institution_id: assignment.institution_id,
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
