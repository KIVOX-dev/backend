const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const recordActivity = require('./recordActivity');

// Placement events the Reports & Compliance audit log lists.
const PLACEMENT_ACTIONS = Object.freeze({
  ADDED: 'placement_added',
  VERIFIED: 'placement_verified',
  DELETED: 'placement_deleted',
});
const AUDIT_ACTIONS = [...Object.values(PLACEMENT_ACTIONS), 'offer_letter_reminder'];

// Writes one audit entry for a placement record. The student's name, batch
// and department are snapshotted into the entry's metadata: an audit trail
// should read the way things were when they happened, and the institution /
// batch / department fields are what let the report filter by them.
// Fire-and-forget like recordActivity itself — never fails the request.
async function recordPlacementEvent(actor, action, record, extra = {}) {
  try {
    const student = await studentRepository.findById(record.student_id);
    const user = student ? await userRepository.findById(student.user_id) : null;
    await recordActivity({
      userId: actor.id,
      action,
      entityType: 'placement_record',
      entityId: record.id,
      metadata: {
        institution_id: record.institution_id,
        student_id: record.student_id,
        student_name: user?.full_name || null,
        batch_year: student?.batch_year ?? null,
        department_id: student?.department_id ?? null,
        company_name: record.company_name,
        ...extra,
      },
    });
  } catch {
    // recordActivity already logs its own failures; a lookup failure here
    // must not break the placement action being audited.
  }
}

module.exports = { PLACEMENT_ACTIONS, AUDIT_ACTIONS, recordPlacementEvent };
