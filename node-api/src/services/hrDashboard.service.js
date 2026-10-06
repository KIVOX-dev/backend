const placementApplicationRepository = require('../repositories/placementApplication.repository');
const hrInterviewRepository = require('../repositories/hrInterview.repository');
const hrEmployeeRepository = require('../repositories/hrEmployee.repository');
const { ownedPlacements, getOrgId } = require('../utils/hrScope');
const hrEmployee = require('./hrEmployee.service');
const candidates = require('./hrCandidate.service');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const OPEN_STATUSES = ['open', 'active'];

class HrDashboardService {
  // tz_offset_minutes decides where "today" starts (default IST, UTC+5:30).
  async summary(actor, { tz_offset_minutes: tzParam } = {}) {
    const tz = Number.isFinite(Number(tzParam)) && tzParam !== undefined ? Number(tzParam) : 330;
    const now = Date.now();
    const localMidnight = Math.floor((now + tz * MIN) / DAY) * DAY - tz * MIN;
    const dayStart = new Date(localMidnight);
    const dayEnd = new Date(localMidnight + DAY);

    const placements = await ownedPlacements(actor);
    const ids = placements.map((p) => p.id);
    const orgId = await getOrgId(actor);
    const interviewScope = ids.length ? { placement_id: { $in: ids } } : { placement_id: { $in: [] } };

    const [apps, todays, upcomingDocs, awaitingFeedback, employeeStats] = await Promise.all([
      ids.length ? placementApplicationRepository.collection.find({ placement_id: { $in: ids } }).project({ status: 1, created_at: 1, placement_id: 1, student_id: 1, hired_at: 1 }).limit(50000).toArray() : [],
      hrInterviewRepository.collection.countDocuments({ ...interviewScope, status: { $in: ['scheduled', 'rescheduled', 'completed'] }, scheduled_at: { $gte: dayStart, $lt: dayEnd } }),
      hrInterviewRepository.collection.find({ ...interviewScope, status: { $in: ['scheduled', 'rescheduled'] }, scheduled_at: { $gte: new Date(now) } }).sort({ scheduled_at: 1 }).limit(5).toArray(),
      // Interviews whose time has passed with no feedback recorded.
      hrInterviewRepository.collection.find({ ...interviewScope, status: { $in: ['scheduled', 'rescheduled', 'completed'] }, end_at: { $lt: new Date(now) }, 'feedback.0': { $exists: false } }).project({ _id: 1 }).limit(500).toArray(),
      hrEmployee.stats(actor),
    ]);

    const count = (...statuses) => apps.filter((a) => statuses.includes(a.status)).length;
    const openPositions = placements.filter((p) => OPEN_STATUSES.includes(p.status) && p.is_active !== false && (!p.application_deadline || new Date(p.application_deadline) >= dayStart));
    const closingSoon = openPositions.filter((p) => p.application_deadline && new Date(p.application_deadline) < new Date(now + 7 * DAY));
    const newApplicants = apps.filter((a) => a.status === 'applied');
    const stale = newApplicants.filter((a) => now - new Date(a.created_at).getTime() > 3 * DAY);

    const pendingOnboarding = orgId || actor.role === 'super_admin'
      ? await hrEmployeeRepository.collection.countDocuments({ ...(orgId ? { org_id: orgId } : {}), status: 'onboarding' })
      : 0;
    const joiningPending = count('selected');

    const actions = [
      { type: 'review_new_applicants', label: 'Applications awaiting review', count: newApplicants.length, urgent: stale.length > 0, urgent_count: stale.length },
      { type: 'interview_feedback', label: 'Interviews awaiting feedback', count: awaitingFeedback.length, urgent: awaitingFeedback.length > 0 },
      { type: 'offers_to_close', label: 'Selected candidates not yet hired', count: joiningPending, urgent: false },
      { type: 'onboarding', label: 'Employees still onboarding', count: pendingOnboarding, urgent: false },
      { type: 'vacancies_closing', label: 'Vacancies closing within 7 days', count: closingSoon.length, urgent: closingSoon.length > 0 },
      { type: 'draft_vacancies', label: 'Draft vacancies to publish', count: placements.filter((p) => p.status === 'draft').length, urgent: false },
    ].filter((a) => a.count > 0);

    const upcoming = upcomingDocs.map((d) => hrInterviewRepository._toEntity(d));
    const summaries = await candidates.summaries(upcoming.map((u) => u.student_id));

    return {
      generated_at: new Date(now),
      day: { start: dayStart, end: dayEnd, tz_offset_minutes: tz },
      total_employees: employeeStats.total_employees,
      open_positions: openPositions.length,
      total_applicants: apps.length,
      interviews_today: todays,
      candidates_selected: count('selected', 'hired'),
      pending_hr_actions: { total: actions.reduce((s, a) => s + a.count, 0), items: actions },
      pipeline: {
        applied: count('applied'), screening: count('screening'), shortlisted: count('shortlisted'), interview: count('interview'),
        selected: count('selected'), hired: count('hired'), rejected: count('rejected'),
      },
      upcoming_interviews: upcoming.map((u) => ({ id: u.id, title: u.title, scheduled_at: u.scheduled_at, mode: u.mode, round: u.round, candidate: summaries.get(u.student_id)?.full_name || null })),
      headcount: { by_department: employeeStats.by_department, by_status: employeeStats.by_status },
    };
  }
}

module.exports = new HrDashboardService();
