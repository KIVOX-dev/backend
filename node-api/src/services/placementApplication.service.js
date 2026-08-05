const BaseService = require('./BaseService');
const placementApplicationRepository = require('../repositories/placementApplication.repository');
const placementRepository = require('../repositories/placement.repository');
const studentRepository = require('../repositories/student.repository');
const { ROLES } = require('../config/constants');
const { buildInstitutionFilter, assertInstitutionOwnership } = require('../utils/authz');
const ApiError = require('../utils/ApiError');

const STAFF_ROLES = [ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY];

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
  // Staff supplying a student_id instead take the shortlist-on-behalf path below.
  async create(data, actor) {
    if (STAFF_ROLES.includes(actor.role) && data.student_id) {
      return this.createOnBehalf(data, actor);
    }
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

  // Staff proactively shortlisting a candidate for a drive — e.g. a recruiter
  // suggestion — without requiring the student to have self-applied first.
  // Idempotent against the (placement_id, student_id) unique index: if an
  // application already exists (the student DID apply), it's promoted to
  // shortlisted in place instead of colliding on create.
  async createOnBehalf(data, actor) {
    const placement = await placementRepository.findById(data.placement_id);
    if (!placement) throw ApiError.badRequest('placement_id does not reference a valid drive');
    if (actor.role !== ROLES.SUPER_ADMIN && placement.institution_id !== actor.institutionId) {
      throw ApiError.forbidden('You may only shortlist for drives in your own institution');
    }

    const student = await studentRepository.findById(data.student_id);
    if (!student) throw ApiError.badRequest('student_id does not reference a valid student');
    if (actor.role !== ROLES.SUPER_ADMIN && student.institution_id !== actor.institutionId) {
      throw ApiError.forbidden('You may only shortlist students in your own institution');
    }

    const roundFields = data.round ? { round: data.round } : {};
    const existing = await this.repository.findOne({ placement_id: data.placement_id, student_id: data.student_id });
    if (existing) {
      return this.repository.updateById(existing.id, { status: 'shortlisted', ...roundFields });
    }

    return this.repository.create({
      placement_id: data.placement_id,
      student_id: data.student_id,
      institution_id: student.institution_id,
      status: 'shortlisted',
      ...roundFields,
    });
  }

  // Bulk twin of createOnBehalf — student_ids are already resolved (the
  // caller matched an uploaded roster against known students client-side;
  // see placementApplication.validation.js#bulkShortlist). One batched
  // existing-applications lookup instead of a findOne per student, since a
  // roster upload can realistically be a few hundred rows.
  async bulkShortlist(data, actor) {
    const placement = await placementRepository.findById(data.placement_id);
    if (!placement) throw ApiError.badRequest('placement_id does not reference a valid drive');
    if (actor.role !== ROLES.SUPER_ADMIN && placement.institution_id !== actor.institutionId) {
      throw ApiError.forbidden('You may only shortlist for drives in your own institution');
    }

    const uniqueStudentIds = [...new Set(data.student_ids)];
    const students = await studentRepository.findByIds(uniqueStudentIds);
    const inInstitution = actor.role === ROLES.SUPER_ADMIN
      ? students
      : students.filter((s) => s.institution_id === actor.institutionId);
    if (inInstitution.length === 0) {
      throw ApiError.badRequest('None of the given students belong to this institution');
    }

    const existingApplications = await placementApplicationRepository.findByPlacementIds([data.placement_id]);
    const existingByStudentId = new Map(existingApplications.map((a) => [a.student_id, a]));
    const roundFields = data.round ? { round: data.round } : {};

    for (const student of inInstitution) {
      const existing = existingByStudentId.get(student.id);
      if (existing) {
        await this.repository.updateById(existing.id, { status: 'shortlisted', ...roundFields });
      } else {
        await this.repository.create({
          placement_id: data.placement_id,
          student_id: student.id,
          institution_id: student.institution_id,
          status: 'shortlisted',
          ...roundFields,
        });
      }
    }

    return { shortlisted_count: inInstitution.length, requested_count: uniqueStudentIds.length };
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
