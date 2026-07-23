const BaseService = require('./BaseService');
const placementApplicationRepository = require('../repositories/placementApplication.repository');
const studentRepository = require('../repositories/student.repository');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');

class PlacementApplicationService extends BaseService {
  constructor() {
    super(placementApplicationRepository, { entityName: 'Application' });
  }

  async list(queryParams, actor) {
    const extraFilters = {};
    if (actor.role === ROLES.STUDENT) {
      const student = await studentRepository.findByUserId(actor.id);
      extraFilters.student_id = student ? student.id : null;
    }
    return super.list(queryParams, extraFilters);
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
    }

    return this.repository.updateById(id, { status });
  }
}

module.exports = new PlacementApplicationService();
