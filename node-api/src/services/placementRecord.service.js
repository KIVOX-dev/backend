const BaseService = require('./BaseService');
const placementRecordRepository = require('../repositories/placementRecord.repository');
const studentRepository = require('../repositories/student.repository');
const { ROLES } = require('../config/constants');
const { assertInstitutionOwnership } = require('../utils/authz');
const { sign } = require('../utils/signedUrl');
const placementProofStorage = require('../utils/placementProofStorage');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { PLACEMENT_ACTIONS, recordPlacementEvent } = require('../utils/placementAudit');
const { securityEvent, EVENTS } = require('../utils/securityLog');

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

    // Whoever holds verify() authority (admin/super_admin only — see below)
    // entering a placement themselves has nothing left to review; only
    // defer to the pending-approval flow for roles that can create on a
    // student's behalf but can't verify (faculty, HR).
    const canSelfVerify = actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.INSTITUTION_ADMIN;

    // Filed under the student's own institution folder — see
    // utils/placementProofStorage.js.
    const proofUrl = proofFile
      ? await placementProofStorage.save(proofFile.buffer, {
          institutionId: student.institution_id,
          extension: proofFile.extension,
          contentType: proofFile.mimetype,
        })
      : undefined;

    const record = await this.repository.create({
      student_id: student.id,
      institution_id: student.institution_id,
      company_name: data.company_name,
      role: data.role,
      salary_lpa: data.salary_lpa,
      work_type: data.work_type,
      mode: data.mode,
      location: data.location,
      proof_url: proofUrl,
      ...(canSelfVerify ? { verification_status: 'verified', verified_by: actor.id, verified_at: new Date() } : {}),
    });

    await studentRepository.updateById(student.id, { placement_status: 'placed' });
    await recordPlacementEvent(actor, PLACEMENT_ACTIONS.ADDED, record, { has_offer_letter: Boolean(proofUrl) });
    return record;
  }

  // Issues a short-lived signed URL for this record's proof document — see
  // routes/placementProofFiles.routes.js and utils/signedUrl.js. Ownership
  // is intentionally stricter than assertInstitutionOwnership alone would
  // give: a student caller must be the record's own student (not just any
  // student sharing the same institution_id, which is all
  // assertInstitutionOwnership itself checks), while staff/super_admin
  // follow the same institution-scoping every other record endpoint uses.
  async getProofUrl(id, actor) {
    const record = await this.repository.findById(id);
    if (!record) throw ApiError.notFound('Placement record not found');

    if (actor.role === ROLES.STUDENT) {
      const student = await studentRepository.findByUserId(actor.id);
      if (!student || student.id !== record.student_id) {
        throw ApiError.forbidden('You do not have access to this resource');
      }
    } else {
      assertInstitutionOwnership(actor, record);
    }

    if (!record.proof_url) throw ApiError.notFound('This placement record has no proof document');
    securityEvent(EVENTS.DOCUMENT_ACCESS_GRANTED, { document: 'placement_proof', targetId: record.id, studentId: record.student_id });
    return { url: sign(record.proof_url) };
  }

  // Adds or replaces the offer letter on an existing placement — how a
  // student acts on an "offer letter needed" reminder. A student may do this
  // only while the record is unverified (swapping the letter on something an
  // admin already verified would quietly void that check); re-uploading over
  // a rejected one sends it back for review. Staff can attach at any time.
  async attachProof(id, actor, proofFile) {
    if (!proofFile) throw ApiError.badRequest('Attach a PDF, JPEG or PNG file');
    const record = await this.repository.findById(id);
    if (!record) throw ApiError.notFound('Placement record not found');

    const isStudent = actor.role === ROLES.STUDENT;
    if (isStudent) {
      const student = await studentRepository.findByUserId(actor.id);
      if (!student || student.id !== record.student_id) throw ApiError.forbidden('You do not have access to this resource');
      if (record.verification_status === 'verified') {
        throw ApiError.forbidden('This placement is already verified — ask your placement office to change it');
      }
    } else if (STAFF_ROLES.includes(actor.role)) {
      assertInstitutionOwnership(actor, record);
    } else {
      throw ApiError.forbidden('Not authorized to change this placement');
    }

    const newUrl = await placementProofStorage.save(proofFile.buffer, {
      institutionId: record.institution_id,
      extension: proofFile.extension,
      contentType: proofFile.mimetype,
    });
    const patch = { proof_url: newUrl };
    if (isStudent && record.verification_status === 'rejected') patch.verification_status = 'pending';
    const updated = await this.repository.updateById(id, patch);

    if (record.proof_url) {
      try {
        await placementProofStorage.remove(record.proof_url);
      } catch (err) {
        logger.error('Replaced placement proof file delete failed', { proofUrl: record.proof_url, error: err.message });
      }
    }
    await recordPlacementEvent(actor, PLACEMENT_ACTIONS.LETTER_ATTACHED, record);
    return updated;
  }

  // The only way an offer letter is ever deleted: an admin removing the
  // whole record. The record goes first, then its file — a failed file
  // delete leaves an orphan (logged, and versioning keeps it recoverable)
  // rather than a record pointing at nothing.
  async remove(id, actor) {
    const record = await this.repository.findById(id);
    if (!record) throw ApiError.notFound('Placement record not found');
    assertInstitutionOwnership(actor, record);

    await this.repository.deleteById(id);
    await recordPlacementEvent(actor, PLACEMENT_ACTIONS.DELETED, record, { had_offer_letter: Boolean(record.proof_url) });
    securityEvent(EVENTS.RECORD_DELETED, { document: 'placement_record', targetId: record.id, studentId: record.student_id });

    if (record.proof_url) {
      try {
        await placementProofStorage.remove(record.proof_url);
      } catch (err) {
        logger.error('Placement proof file delete failed', { proofUrl: record.proof_url, error: err.message });
      }
    }

    // No records left = no longer "placed".
    if ((await this.repository.countForStudent(record.student_id)) === 0) {
      await studentRepository.updateById(record.student_id, { placement_status: null });
    }
  }

  async verify(id, verificationStatus, actor) {
    const record = await this.repository.findById(id);
    if (!record) throw ApiError.notFound('Placement record not found');
    assertInstitutionOwnership(actor, record);

    const updated = await this.repository.updateById(id, {
      verification_status: verificationStatus,
      verified_by: actor.id,
      verified_at: new Date(),
    });
    await recordPlacementEvent(actor, PLACEMENT_ACTIONS.VERIFIED, record, { verification_status: verificationStatus });
    return updated;
  }
}

module.exports = new PlacementRecordService();
