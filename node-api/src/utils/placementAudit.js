const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const recordActivity = require('./recordActivity');

// Placement and outcome events the Reports & Compliance audit log lists.
const PLACEMENT_ACTIONS = Object.freeze({
  ADDED: 'placement_added',
  VERIFIED: 'placement_verified',
  DELETED: 'placement_deleted',
  LETTER_ATTACHED: 'placement_letter_attached',
});
const OUTCOME_ACTIONS = Object.freeze({
  ADDED: 'outcome_added',
  VERIFIED: 'outcome_verified',
  DELETED: 'outcome_deleted',
  PROOF_ATTACHED: 'outcome_proof_attached',
});
const AUDIT_ACTIONS = [...Object.values(PLACEMENT_ACTIONS), ...Object.values(OUTCOME_ACTIONS), 'offer_letter_reminder'];

// What an audit entry says about the student, snapshotted: an audit trail
// should read the way things were when they happened, and the institution /
// batch / department fields are what let the report filter by them.
async function studentSnapshot(record) {
  const student = await studentRepository.findById(record.student_id);
  const user = student ? await userRepository.findById(student.user_id) : null;
  return {
    institution_id: record.institution_id,
    student_id: record.student_id,
    student_name: user?.full_name || null,
    batch_year: student?.batch_year ?? null,
    department_id: student?.department_id ?? null,
  };
}

// Fire-and-forget like recordActivity itself — never fails the request.
async function writeEvent(actor, action, entityType, record, metadata) {
  try {
    await recordActivity({
      userId: actor.id,
      action,
      entityType,
      entityId: record.id,
      metadata: { ...(await studentSnapshot(record)), ...metadata },
    });
  } catch {
    // recordActivity already logs its own failures; a lookup failure here
    // must not break the action being audited.
  }
}

const recordPlacementEvent = (actor, action, record, extra = {}) =>
  writeEvent(actor, action, 'placement_record', record, { company_name: record.company_name, ...extra });

// `subject` is the one-line "what" shown in the log: the exam, or the course
// and where it is.
function outcomeSubject(outcome) {
  return outcome.type === 'higher_study'
    ? `${outcome.course} — ${outcome.institution_name}`
    : `${outcome.exam} ${outcome.exam_year}`;
}

const recordOutcomeEvent = (actor, action, outcome, extra = {}) =>
  writeEvent(actor, action, 'student_outcome', outcome, { subject: outcomeSubject(outcome), outcome_type: outcome.type, ...extra });

module.exports = { PLACEMENT_ACTIONS, OUTCOME_ACTIONS, AUDIT_ACTIONS, recordPlacementEvent, recordOutcomeEvent, outcomeSubject };
