// An interview scheduled by HR against one placement application.
// interviewers: [{ user_id?, name, email? }] — internal panel; feedback is
// one entry per panelist (keyed by `interviewer_key`), see hrInterview.service.js.
module.exports = {
  tableName: 'hr_interviews',
  columns: [
    'org_id', 'application_id', 'placement_id', 'student_id', 'recruiter_id', 'round', 'title',
    'mode', 'scheduled_at', 'end_at', 'duration_minutes', 'location', 'meeting_link', 'interviewers',
    'status', 'result', 'notes', 'feedback', 'reschedule_count', 'history',
    'cancel_reason', 'completed_at', 'created_by',
  ],
  defaults: { status: 'scheduled', mode: 'online', round: 1, interviewers: [], feedback: [], history: [], reschedule_count: 0 },
};
