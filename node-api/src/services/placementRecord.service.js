const BaseService = require('./BaseService');
const placementRecordRepository = require('../repositories/placementRecord.repository');
const studentRepository = require('../repositories/student.repository');
const { ROLES } = require('../config/constants');
const { assertInstitutionOwnership } = require('../utils/authz');
const ApiError = require('../utils/ApiError');

const STAFF_ROLES = [ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.HR];

class PlacementRecordService extends BaseService {
  constructor() {
    super(placementRecordRepository, { entityName: 'Placement record' });
  }

  async list(queryParams, actor) {
    const extraFilters = actor.role === ROLES.SUPER_ADMIN ? {} : { institution_id: actor.institutionId };
    return super.list(queryParams, extraFilters);
  }

  async listForStudent(studentId, queryParams, actor) {
    const extraFilters = { student_id: studentId };
    if (actor.role !== ROLES.SUPER_ADMIN) extraFilters.institution_id = actor.institutionId;
    return super.list(queryParams, extraFilters);
  }

  // python-service's original create_placement let ANY authenticated user
  // supply an arbitrary student_id with no ownership/role check — a student
  // could report a placement under someone else's name, or staff could do so
  // for a student outside their institution. Tightened here (not carried
  // forward, per the migration plan's "fix immediately" rule): a student can
  // only self-report their own placement; staff can report on behalf of a
  // specific student in their own institution.
  async create(data, actor, proofFile) {
    let student;
    if (actor.role === ROLES.STUDENT) {
      student = await studentRepository.findByUserId(actor.id);
      if (!student) throw ApiError.badRequest('No student profile is linked to this account');
    } else if (STAFF_ROLES.includes(actor.role)) {
      if (!data.student_id) throw ApiError.badRequest('student_id is required');
      student = await studentRepository.findById(data.student_id);
      if (!student) throw ApiError.notFound('Student not found');
      if (actor.role !== ROLES.SUPER_ADMIN && student.institution_id !== actor.institutionId) {
        throw ApiError.forbidden('You may only report placements for students in your own institution');
      }
    } else {
      throw ApiError.forbidden('Not authorized to report a placement');
    }

    const record = await this.repository.create({
      student_id: student.id,
      institution_id: student.institution_id,
      company_name: data.company_name,
      role: data.role,
      salary_lpa: data.salary_lpa,
      work_type: data.work_type,
      mode: data.mode,
      location: data.location,
      // Served back via app.js's existing /uploads static mount.
      proof_url: proofFile ? `/uploads/placement-proof/${proofFile.filename}` : undefined,
    });

    await studentRepository.updateById(student.id, { placement_status: 'placed' });
    return record;
  }

  async verify(id, verificationStatus, actor) {
    const record = await this.repository.findById(id);
    if (!record) throw ApiError.notFound('Placement record not found');
    assertInstitutionOwnership(actor, record);

    return this.repository.updateById(id, {
      verification_status: verificationStatus,
      verified_by: actor.id,
      verified_at: new Date(),
    });
  }
}

module.exports = new PlacementRecordService();
