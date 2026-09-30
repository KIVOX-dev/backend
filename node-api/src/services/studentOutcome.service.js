const BaseService = require('./BaseService');
const studentOutcomeRepository = require('../repositories/studentOutcome.repository');
const studentRepository = require('../repositories/student.repository');
const { ROLES } = require('../config/constants');
const { assertInstitutionOwnership } = require('../utils/authz');
const { sign } = require('../utils/signedUrl');
const outcomeProofStorage = require('../utils/outcomeProofStorage');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { securityEvent, EVENTS } = require('../utils/securityLog');
const { OUTCOME_ACTIONS, recordOutcomeEvent } = require('../utils/placementAudit');

const STAFF_ROLES = [ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY];

// Multipart forms send '' for an untouched optional field; store those as
// absent rather than as empty strings.
function blankToUndefined(data) {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '' && v !== null && v !== undefined));
}

// Higher-study admissions and competitive-exam results, reported by the
// student or entered by staff on their behalf, then verified by an admin.
// Mirrors placementRecord.service.js: a student reports only for themselves,
// staff only within their own institution, and only an admin verifies or
// deletes.
class StudentOutcomeService extends BaseService {
  constructor() {
    super(studentOutcomeRepository, { entityName: 'Outcome' });
  }

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
        throw ApiError.forbidden('You may only report outcomes for students in your own institution');
      }
    } else {
      throw ApiError.forbidden('Not authorized to report an outcome');
    }

    // An admin entering it themselves has nothing left to review.
    const canSelfVerify = actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.INSTITUTION_ADMIN;

    const fields = blankToUndefined(data);
    delete fields.student_id; // which student is decided above, never taken from the body for a student
    const proofUrl = proofFile
      ? await outcomeProofStorage.save(proofFile.buffer, {
          institutionId: student.institution_id,
          extension: proofFile.extension,
          contentType: proofFile.mimetype,
        })
      : undefined;

    const outcome = await this.repository.create({
      ...fields,
      student_id: student.id,
      institution_id: student.institution_id,
      proof_url: proofUrl,
      reported_by: actor.id,
      ...(canSelfVerify ? { verification_status: 'verified', verified_by: actor.id, verified_at: new Date() } : {}),
    });
    await recordOutcomeEvent(actor, OUTCOME_ACTIONS.ADDED, outcome, { has_proof: Boolean(proofUrl) });
    return outcome;
  }

  // Everything one student has reported — their own view, or staff checking
  // a student in their institution.
  async listForStudent(studentId, actor) {
    const student = await studentRepository.findById(studentId);
    if (!student) throw ApiError.notFound('Student not found');
    if (actor.role === ROLES.STUDENT) {
      if (student.user_id !== actor.id) throw ApiError.forbidden('You do not have access to this resource');
    } else {
      assertInstitutionOwnership(actor, student);
    }
    const docs = await this.repository.collection.find({ student_id: studentId }).sort({ created_at: -1 }).toArray();
    return docs.map((d) => this.repository._toEntity(d));
  }

  async loadAccessible(id, actor) {
    const outcome = await this.repository.findById(id);
    if (!outcome) throw ApiError.notFound('Outcome not found');
    if (actor.role === ROLES.STUDENT) {
      const student = await studentRepository.findByUserId(actor.id);
      if (!student || student.id !== outcome.student_id) throw ApiError.forbidden('You do not have access to this resource');
    } else {
      assertInstitutionOwnership(actor, outcome);
    }
    return outcome;
  }

  async getProofUrl(id, actor) {
    const outcome = await this.loadAccessible(id, actor);
    if (!outcome.proof_url) throw ApiError.notFound('This record has no supporting document');
    securityEvent(EVENTS.DOCUMENT_ACCESS_GRANTED, { document: 'outcome_proof', targetId: outcome.id, studentId: outcome.student_id });
    return { url: sign(outcome.proof_url) };
  }

  // Adds or replaces the supporting document. A student may only do this
  // while the record is unverified — replacing the proof on something an
  // admin already verified would quietly void that check — and replacing a
  // rejected one sends it back for review. Staff can attach at any time.
  async attachProof(id, actor, proofFile) {
    if (!proofFile) throw ApiError.badRequest('Attach a PDF, JPEG or PNG file');
    const outcome = await this.loadAccessible(id, actor);

    const isStudent = actor.role === ROLES.STUDENT;
    if (isStudent && outcome.verification_status === 'verified') {
      throw ApiError.forbidden('This record is already verified — ask your placement office to change it');
    }

    const newUrl = await outcomeProofStorage.save(proofFile.buffer, {
      institutionId: outcome.institution_id,
      extension: proofFile.extension,
      contentType: proofFile.mimetype,
    });
    const patch = { proof_url: newUrl };
    if (isStudent && outcome.verification_status === 'rejected') patch.verification_status = 'pending';
    const updated = await this.repository.updateById(id, patch);

    if (outcome.proof_url) {
      try {
        await outcomeProofStorage.remove(outcome.proof_url);
      } catch (err) {
        logger.error('Replaced outcome proof file delete failed', { proofUrl: outcome.proof_url, error: err.message });
      }
    }
    await recordOutcomeEvent(actor, OUTCOME_ACTIONS.PROOF_ATTACHED, outcome);
    return updated;
  }

  async verify(id, verificationStatus, actor) {
    const outcome = await this.repository.findById(id);
    if (!outcome) throw ApiError.notFound('Outcome not found');
    assertInstitutionOwnership(actor, outcome);

    const updated = await this.repository.updateById(id, {
      verification_status: verificationStatus,
      verified_by: actor.id,
      verified_at: new Date(),
    });
    await recordOutcomeEvent(actor, OUTCOME_ACTIONS.VERIFIED, outcome, { verification_status: verificationStatus });
    return updated;
  }

  // The only way an outcome (and its document) is deleted: an admin removing
  // the record. Record first, then file — a failed file delete leaves an
  // orphan (logged, and bucket versioning keeps it recoverable) rather than a
  // record pointing at nothing.
  async remove(id, actor) {
    const outcome = await this.repository.findById(id);
    if (!outcome) throw ApiError.notFound('Outcome not found');
    assertInstitutionOwnership(actor, outcome);

    await this.repository.deleteById(id);
    await recordOutcomeEvent(actor, OUTCOME_ACTIONS.DELETED, outcome, { had_proof: Boolean(outcome.proof_url) });
    securityEvent(EVENTS.RECORD_DELETED, { document: 'student_outcome', targetId: outcome.id, studentId: outcome.student_id });

    if (outcome.proof_url) {
      try {
        await outcomeProofStorage.remove(outcome.proof_url);
      } catch (err) {
        logger.error('Outcome proof file delete failed', { proofUrl: outcome.proof_url, error: err.message });
      }
    }
  }
}

module.exports = new StudentOutcomeService();
