const BaseService = require('./BaseService');
const placementApplicationRepository = require('../repositories/placementApplication.repository');
const studentRepository = require('../repositories/student.repository');
const { ROLES } = require('../config/constants');
const { buildInstitutionFilter, assertInstitutionOwnership } = require('../utils/authz');
const ApiError = require('../utils/ApiError');

class PlacementApplicationService extends BaseService {
  constructor() {
    super(placementApplicationRepository, { entityName: 'Application' });
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

  // A student can only ever create an application for THEIR OWN student_id — it is
  // always derived from the authenticated user, never accepted from the request body.
  async create(data, actor) {
    if (actor.role !== ROLES.STUDENT) {
      throw ApiError.forbidden('Only students may apply to a placement');
    }
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.badRequest('No student profile is linked to this account');

    return this.repository.create({
      placement_id: data.placement_id,
      student_id: student.id,
      institution_id: student.institution_id,
      status: 'applied',
    });
  }

  async updateStatus(id, status, actor) {
    const application = await this.repository.findById(id);
    if (!application) throw ApiError.notFound('Application not found');

    if (actor.role === ROLES.STUDENT) {
      if (status !== 'withdrawn') {
        throw ApiError.forbidden('Students may only withdraw their own application');
      }
      const student = await studentRepository.findByUserId(actor.id);
      if (!student || application.student_id !== student.id) {
        throw ApiError.forbidden('You may only withdraw your own application');
      }
    } else if (actor.role === ROLES.INSTITUTION_ADMIN || actor.role === ROLES.FACULTY) {
      // HR and SUPER_ADMIN are exempt by design: HR recruits across institutions
      // via /placements/applications/me, and super_admin is global.
      assertInstitutionOwnership(actor, application);
    }

    return this.repository.updateById(id, { status });
  }
}

module.exports = new PlacementApplicationService();
