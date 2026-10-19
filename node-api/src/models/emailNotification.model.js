// One row per (entity, student, event, round): the idempotency record for
// every transactional email the platform sends about a business object —
// today a test being assigned, a placement drive being assigned, and a student
// being shortlisted for a drive round. (Named email_notifications because
// `notifications` is already the in-app notification collection.)
//
// The unique index in scripts/setupIndexes.js over
// {entity_type, entity_id, student_id, event_type, round_number} is what
// guarantees one email per student per event. round_number is always written
// (null for events that have no round) so the index treats those rows as equal.
//
// entity_type: 'test' | 'drive' | 'institution' (account_created: one row per
//              onboarded student, grouped by the institution they joined)
// event_type:  'test_assigned' | 'drive_assigned' | 'round_shortlisted' | 'account_created'
//              (a future 'not_selected' only needs a new handler — see
//              services/notificationHandlers/)
// status: queued -> sending -> sent | failed. `sending` is internal (a worker
// has claimed the row); summaries count it as pending.
module.exports = {
  tableName: 'email_notifications',
  columns: [
    'entity_type', 'entity_id', 'student_id', 'event_type', 'round_number', 'institution_id',
    'email', 'status', 'attempts', 'brevo_message_id', 'error_message', 'sent_at', 'locked_at',
    // account_created only: whether the student was given the default password
    // (so the email may show it). The password itself is never stored here.
    'uses_default_password',
  ],
  defaults: { status: 'queued', attempts: 0, round_number: null },
};
