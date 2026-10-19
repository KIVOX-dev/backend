const BaseService = require('./BaseService');
const placementApplicationRepository = require('../repositories/placementApplication.repository');
const placementRepository = require('../repositories/placement.repository');
const studentRepository = require('../repositories/student.repository');
const hrPipeline = require('./hrPipeline.service');
const { ownsPlacement } = require('../utils/hrScope');
const { ROLES } = require('../config/constants');
const { buildInstitutionFilter, assertInstitutionOwnership } = require('../utils/authz');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const driveNotificationService = require('./driveNotification.service');

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

    const placement = await placementRepository.findById(data.placement_id);
    return this.repository.create({
      placement_id: data.placement_id,
      student_id: student.id,
      institution_id: student.institution_id,
      status: 'applied',
      source: 'direct_application',
      recruiter_id: placement ? placement.recruiter_id || null : null,
      stage_history: [{ from: null, to: 'applied', at: new Date(), by: actor.id }],
    });
  }

  // History entry + timestamp for a staff shortlist, so shortlisted candidates
  // show up correctly in the HR pipeline and analytics.
  _shortlistFields(actor, placement) {
    return {
      source: 'campus_shortlist',
      recruiter_id: placement.recruiter_id || null,
      shortlisted_at: new Date(),
      stage_history: [{ from: null, to: 'shortlisted', at: new Date(), by: actor.id }],
    };
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
    let application;
    if (existing) {
      const updated = await hrPipeline.applyTransition(existing, 'shortlisted', actor);
      application = roundFields.round ? await this.repository.updateById(existing.id, roundFields) : updated;
    } else {
      application = await this.repository.create({
        placement_id: data.placement_id,
        student_id: data.student_id,
        institution_id: student.institution_id,
        status: 'shortlisted',
        ...this._shortlistFields(actor, placement),
        ...roundFields,
      });
    }
    const notifying_count = await this.#notifyRound(placement, data.round, [student.id]);
    return { ...application, notifying_count };
  }

  // Shortlisting is already saved when this runs; an email problem must never
  // fail the request (rows are recorded first and can be resent). Only round 2
  // and later email — see driveNotification.service.js#notifyRoundShortlisted.
  async #notifyRound(placement, round, studentIds) {
    try {
      return await driveNotificationService.notifyRoundShortlisted(placement, round, studentIds);
    } catch (err) {
      logger.error('Could not queue round-shortlist emails', { placementId: placement.id, round, error: err.message });
      return 0;
    }
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

    let skipped = 0;
    const shortlistedIds = [];
    for (const student of inInstitution) {
      const existing = existingByStudentId.get(student.id);
      if (existing) {
        try {
          await hrPipeline.applyTransition(existing, 'shortlisted', actor);
        } catch (err) {
          if (err.statusCode !== 409) throw err;
          skipped += 1; // already hired/withdrawn — can't be re-shortlisted
          continue;
        }
        if (roundFields.round) await this.repository.updateById(existing.id, roundFields);
        shortlistedIds.push(student.id);
      } else {
        await this.repository.create({
          placement_id: data.placement_id,
          student_id: student.id,
          institution_id: student.institution_id,
          status: 'shortlisted',
          ...this._shortlistFields(actor, placement),
          ...roundFields,
        });
        shortlistedIds.push(student.id);
      }
    }

    // Skipped students (already hired/withdrawn) are not emailed.
    const notifying_count = await this.#notifyRound(placement, data.round, shortlistedIds);
    return { shortlisted_count: inInstitution.length - skipped, requested_count: uniqueStudentIds.length, notifying_count };
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
    } else if (actor.role === ROLES.HR) {
      // HR is exempt from institution scoping (it recruits across institutions)
      // but must still own the vacancy — previously any HR user could move any
      // application in the system.
      const placement = await placementRepository.findById(application.placement_id);
      if (!placement || !(await ownsPlacement(actor, placement))) {
        throw ApiError.forbidden("This application belongs to another recruiter's vacancy");
      }
    } else if (actor.role === ROLES.INSTITUTION_ADMIN || actor.role === ROLES.FACULTY) {
      assertInstitutionOwnership(actor, application);
    }

    // Single transition path shared with the HR portal: records stage history
    // and timestamps, notifies the student, and opens onboarding on hire.
    return hrPipeline.applyTransition(application, status, actor);
  }
}

module.exports = new PlacementApplicationService();
