const hrInterviewRepository = require('../repositories/hrInterview.repository');
const placementApplicationRepository = require('../repositories/placementApplication.repository');
const placementRepository = require('../repositories/placement.repository');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const notificationRepository = require('../repositories/notification.repository');
const { getOrgId, ownedPlacements, ownsPlacement } = require('../utils/hrScope');
const hrPipeline = require('./hrPipeline.service');
const evaluationService = require('./hrEvaluation.service');
const candidates = require('./hrCandidate.service');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const ACTIVE = ['scheduled', 'rescheduled'];
const STATUSES = ['scheduled', 'rescheduled', 'completed', 'cancelled', 'no_show'];
const MS_MIN = 60 * 1000;

// Stable key for a panelist: their user id when internal, else their email.
const panelKey = (i) => (i.user_id ? `u:${i.user_id}` : `e:${String(i.email || i.name).toLowerCase()}`);

class HrInterviewService {
  async _loadAuthorised(id, actor, { allowPanel = false } = {}) {
    const interview = await hrInterviewRepository.findById(id);
    if (!interview) throw ApiError.notFound('Interview not found');
    if (actor.role === ROLES.SUPER_ADMIN) return interview;
    const placement = await placementRepository.findById(interview.placement_id);
    if (placement && (await ownsPlacement(actor, placement))) return interview;
    if (allowPanel && (interview.interviewers || []).some((i) => i.user_id === actor.id)) return interview;
    throw ApiError.forbidden('This interview belongs to another recruiter\'s vacancy');
  }

  // Interviews overlapping [start, end) that involve the same candidate or any
  // of the same panelists.
  async findConflicts({ start, end, studentId, interviewers = [], excludeId }) {
    const overlapping = await hrInterviewRepository.collection
      .find({ status: { $in: ACTIVE }, scheduled_at: { $lt: end }, end_at: { $gt: start }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
      .toArray();
    const keys = new Set(interviewers.map(panelKey));
    const conflicts = [];
    for (const doc of overlapping) {
      const sameCandidate = doc.student_id === studentId;
      const sharedPanel = (doc.interviewers || []).filter((i) => keys.has(panelKey(i))).map((i) => i.name || i.email);
      if (sameCandidate || sharedPanel.length) {
        conflicts.push({ interview_id: doc._id, scheduled_at: doc.scheduled_at, end_at: doc.end_at, candidate_conflict: sameCandidate, panelists: sharedPanel });
      }
    }
    return conflicts;
  }

  // Resolves `user_id` panelists to names/emails so the stored panel is
  // self-describing even if the user is later renamed.
  async _resolveInterviewers(list, actor) {
    const resolved = [];
    for (const i of list) {
      if (i.user_id) {
        const u = await userRepository.findById(i.user_id);
        if (!u) throw ApiError.badRequest(`Interviewer ${i.user_id} does not exist`);
        if (actor.role !== ROLES.SUPER_ADMIN && ![ROLES.HR, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.SUPER_ADMIN].includes(u.role)) {
          throw ApiError.badRequest('Internal interviewers must be staff accounts');
        }
        resolved.push({ user_id: u.id, name: i.name || u.full_name, email: u.email });
      } else {
        resolved.push({ name: i.name, email: i.email || null });
      }
    }
    return resolved;
  }

  async _notifyCandidate(interview, title, message) {
    try {
      const student = await studentRepository.findById(interview.student_id);
      if (student) await notificationRepository.create({ user_id: student.user_id, title, message, type: 'interview' });
    } catch (err) {
      logger.error('Failed to notify candidate of interview', { error: err.message, interviewId: interview.id });
    }
  }

  async _notifyPanel(interview, actor, title, message) {
    for (const i of interview.interviewers || []) {
      if (!i.user_id || i.user_id === actor.id) continue;
      try {
        await notificationRepository.create({ user_id: i.user_id, title, message, type: 'interview' });
      } catch (err) {
        logger.error('Failed to notify interviewer', { error: err.message });
      }
    }
  }

  _describe(interview, job) {
    const when = new Date(interview.scheduled_at).toISOString();
    return `${job ? job.title : 'Interview'} — round ${interview.round}, ${interview.mode}, ${when}${interview.meeting_link ? `, ${interview.meeting_link}` : ''}${interview.location ? `, ${interview.location}` : ''}`;
  }

  async schedule(data, actor) {
    const application = await placementApplicationRepository.findById(data.application_id);
    if (!application) throw ApiError.notFound('Application not found');
    const placement = await placementRepository.findById(application.placement_id);
    if (!placement || !(await ownsPlacement(actor, placement))) throw ApiError.forbidden('This application belongs to another recruiter\'s vacancy');
    if (['rejected', 'withdrawn', 'hired'].includes(application.status)) {
      throw ApiError.conflict(`Cannot schedule an interview for an application that is ${application.status}`);
    }

    const start = new Date(data.scheduled_at);
    if (start.getTime() < Date.now() - 5 * MS_MIN) throw ApiError.badRequest('scheduled_at is in the past');
    const duration = data.duration_minutes || 60;
    const end = new Date(start.getTime() + duration * MS_MIN);
    const interviewers = await this._resolveInterviewers(data.interviewers || [], actor);

    if (!data.force) {
      const conflicts = await this.findConflicts({ start, end, studentId: application.student_id, interviewers });
      if (conflicts.length) {
        throw new ApiError(409, 'Scheduling conflict — the candidate or an interviewer is already booked in that slot', conflicts, 'SCHEDULE_CONFLICT');
      }
    }

    const priorRounds = await hrInterviewRepository.collection.countDocuments({ application_id: application.id, status: { $ne: 'cancelled' } });
    const interview = await hrInterviewRepository.create({
      org_id: await getOrgId(actor),
      application_id: application.id,
      placement_id: placement.id,
      student_id: application.student_id,
      recruiter_id: placement.recruiter_id || actor.id,
      round: data.round || priorRounds + 1,
      title: data.title || `${placement.title} — interview`,
      mode: data.mode || 'online',
      scheduled_at: start,
      end_at: end,
      duration_minutes: duration,
      location: data.location || null,
      meeting_link: data.meeting_link || null,
      interviewers,
      notes: data.notes || null,
      created_by: actor.id,
      history: [{ event: 'scheduled', at: new Date(), by: actor.id, scheduled_at: start }],
    });

    // Scheduling an interview is what moves a candidate into the Interview stage.
    if (application.status !== 'interview') {
      await hrPipeline.applyTransition(application, 'interview', actor, { note: `Interview round ${interview.round} scheduled` });
    }
    await this._notifyCandidate(interview, 'Interview scheduled', this._describe(interview, placement));
    await this._notifyPanel(interview, actor, 'You have been added to an interview panel', this._describe(interview, placement));
    return interview;
  }

  async reschedule(id, data, actor) {
    const interview = await this._loadAuthorised(id, actor);
    if (!ACTIVE.includes(interview.status)) throw ApiError.conflict(`A ${interview.status} interview cannot be edited`);

    const start = data.scheduled_at ? new Date(data.scheduled_at) : new Date(interview.scheduled_at);
    const duration = data.duration_minutes || interview.duration_minutes;
    const end = new Date(start.getTime() + duration * MS_MIN);
    const interviewers = data.interviewers ? await this._resolveInterviewers(data.interviewers, actor) : interview.interviewers;
    const timeChanged = start.getTime() !== new Date(interview.scheduled_at).getTime() || duration !== interview.duration_minutes;

    if (timeChanged || data.interviewers) {
      if (timeChanged && start.getTime() < Date.now() - 5 * MS_MIN) throw ApiError.badRequest('scheduled_at is in the past');
      if (!data.force) {
        const conflicts = await this.findConflicts({ start, end, studentId: interview.student_id, interviewers, excludeId: interview.id });
        if (conflicts.length) throw new ApiError(409, 'Scheduling conflict — the candidate or an interviewer is already booked in that slot', conflicts, 'SCHEDULE_CONFLICT');
      }
    }

    const patch = {
      scheduled_at: start, end_at: end, duration_minutes: duration, interviewers,
      mode: data.mode || interview.mode,
      location: data.location !== undefined ? data.location : interview.location,
      meeting_link: data.meeting_link !== undefined ? data.meeting_link : interview.meeting_link,
      title: data.title || interview.title,
      notes: data.notes !== undefined ? data.notes : interview.notes,
      history: [...(interview.history || []), { event: timeChanged ? 'rescheduled' : 'updated', at: new Date(), by: actor.id, from: interview.scheduled_at, to: start, ...(data.reason ? { reason: data.reason } : {}) }],
    };
    if (timeChanged) {
      patch.status = 'rescheduled';
      patch.reschedule_count = (interview.reschedule_count || 0) + 1;
    }
    const updated = await hrInterviewRepository.updateById(id, patch);
    const placement = await placementRepository.findById(updated.placement_id);
    await this._notifyCandidate(updated, timeChanged ? 'Interview rescheduled' : 'Interview details updated', this._describe(updated, placement));
    await this._notifyPanel(updated, actor, timeChanged ? 'Interview rescheduled' : 'Interview details updated', this._describe(updated, placement));
    return updated;
  }

  async setStatus(id, { status, result, reason }, actor) {
    const interview = await this._loadAuthorised(id, actor);
    if (!STATUSES.includes(status)) throw ApiError.badRequest('Invalid interview status');
    if (status === 'scheduled' || status === 'rescheduled') throw ApiError.badRequest('Use the reschedule endpoint to change the time');
    if (!ACTIVE.includes(interview.status) && interview.status !== status) {
      throw ApiError.conflict(`A ${interview.status} interview cannot move to ${status}`);
    }
    const patch = {
      status,
      history: [...(interview.history || []), { event: status, at: new Date(), by: actor.id, ...(reason ? { reason } : {}) }],
    };
    if (status === 'completed') patch.completed_at = new Date();
    if (status === 'cancelled') patch.cancel_reason = reason || null;
    if (result) patch.result = result;
    const updated = await hrInterviewRepository.updateById(id, patch);

    if (status === 'cancelled') {
      const placement = await placementRepository.findById(updated.placement_id);
      await this._notifyCandidate(updated, 'Interview cancelled', `Your interview (${this._describe(updated, placement)}) has been cancelled.${reason ? ` Reason: ${reason}` : ''}`);
      await this._notifyPanel(updated, actor, 'Interview cancelled', `Interview ${this._describe(updated, placement)} was cancelled.`);
    }
    return updated;
  }

  // One feedback entry per panelist; submitting again replaces your own.
  async submitFeedback(id, data, actor) {
    const interview = await this._loadAuthorised(id, actor, { allowPanel: true });
    if (interview.status === 'cancelled') throw ApiError.conflict('Cannot leave feedback on a cancelled interview');
    if (new Date(interview.scheduled_at).getTime() > Date.now() + 15 * MS_MIN && interview.status !== 'completed') {
      throw ApiError.conflict('Feedback can only be submitted once the interview has started');
    }
    const me = await userRepository.findById(actor.id);
    const entry = {
      interviewer_key: `u:${actor.id}`,
      interviewer_id: actor.id,
      interviewer_name: data.interviewer_name || (me && me.full_name) || null,
      rating: data.rating,
      recommendation: data.recommendation,
      skill_ratings: data.skill_ratings || [],
      strengths: data.strengths || null,
      concerns: data.concerns || null,
      comments: data.comments || null,
      submitted_at: new Date(),
    };
    const feedback = [...(interview.feedback || []).filter((f) => f.interviewer_key !== entry.interviewer_key), entry];
    const patch = { feedback };
    if (interview.status !== 'completed') {
      patch.status = 'completed';
      patch.completed_at = new Date();
      patch.history = [...(interview.history || []), { event: 'completed', at: new Date(), by: actor.id, via: 'feedback' }];
    }
    const updated = await hrInterviewRepository.updateById(id, patch);
    await evaluationService.refreshApplicationScore(updated.application_id);
    return { ...updated, feedback_summary: this.summariseFeedback(updated.feedback) };
  }

  summariseFeedback(feedback = []) {
    if (feedback.length === 0) return { count: 0, average_rating: null, recommendations: {} };
    const recommendations = {};
    for (const f of feedback) recommendations[f.recommendation] = (recommendations[f.recommendation] || 0) + 1;
    return {
      count: feedback.length,
      average_rating: Math.round((feedback.reduce((s, f) => s + f.rating, 0) / feedback.length) * 10) / 10,
      recommendations,
    };
  }

  async _decorate(rows) {
    const summaries = await candidates.summaries(rows.map((r) => r.student_id));
    const placements = await placementRepository.findByIds(rows.map((r) => r.placement_id));
    const jobById = new Map(placements.map((p) => [p.id, p]));
    return rows.map((r) => ({
      ...r,
      feedback_summary: this.summariseFeedback(r.feedback),
      job_title: jobById.get(r.placement_id)?.title || null,
      candidate: summaries.get(r.student_id) ? { student_id: r.student_id, full_name: summaries.get(r.student_id).full_name, email: summaries.get(r.student_id).email } : null,
    }));
  }

  async _scopeFilter(actor) {
    if (actor.role === ROLES.SUPER_ADMIN) return {};
    const owned = await ownedPlacements(actor, { _id: 1 });
    // Interviewers who are on a panel but don't own the vacancy see their own interviews too.
    return { $or: [{ placement_id: { $in: owned.map((p) => p.id) } }, { 'interviewers.user_id': actor.id }] };
  }

  _filters(query) {
    const f = {};
    if (query.status) f.status = query.status;
    if (query.placement_id) f.placement_id = query.placement_id;
    if (query.application_id) f.application_id = query.application_id;
    if (query.student_id) f.student_id = query.student_id;
    if (query.mine === 'true' || query.mine === true) f['interviewers.user_id'] = query.__actorId;
    if (query.from || query.to) {
      f.scheduled_at = {};
      if (query.from) f.scheduled_at.$gte = new Date(query.from);
      if (query.to) f.scheduled_at.$lt = new Date(query.to);
    }
    return f;
  }

  async list(actor, query = {}) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const filter = { $and: [await this._scopeFilter(actor), this._filters({ ...query, __actorId: actor.id })] };
    const [docs, total] = await Promise.all([
      hrInterviewRepository.collection.find(filter).sort({ scheduled_at: query.order === 'desc' ? -1 : 1 }).skip((page - 1) * limit).limit(limit).toArray(),
      hrInterviewRepository.collection.countDocuments(filter),
    ]);
    const rows = await this._decorate(docs.map((d) => hrInterviewRepository._toEntity(d)));
    return { rows, meta: { page, limit, total } };
  }

  // Calendar view: interviews in [from, to) grouped by calendar day (in the
  // caller's UTC offset, default IST — most users are in India).
  async calendar(actor, { from, to, tz_offset_minutes: tz = 330, ...rest }) {
    const start = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 60 * MS_MIN);
    const end = to ? new Date(to) : new Date(start.getTime() + 42 * 24 * 60 * MS_MIN);
    if (end - start > 100 * 24 * 60 * MS_MIN) throw ApiError.badRequest('Calendar range cannot exceed 100 days');
    const filter = { $and: [await this._scopeFilter(actor), this._filters({ ...rest, from: start, to: end, __actorId: actor.id })] };
    const docs = await hrInterviewRepository.collection.find(filter).sort({ scheduled_at: 1 }).limit(1000).toArray();
    const rows = await this._decorate(docs.map((d) => hrInterviewRepository._toEntity(d)));

    const days = {};
    for (const r of rows) {
      const local = new Date(new Date(r.scheduled_at).getTime() + Number(tz) * MS_MIN);
      const key = local.toISOString().slice(0, 10);
      (days[key] = days[key] || []).push({
        id: r.id, title: r.title, job_title: r.job_title, start: r.scheduled_at, end: r.end_at, status: r.status, mode: r.mode, round: r.round,
        candidate: r.candidate ? r.candidate.full_name : null, interviewers: (r.interviewers || []).map((i) => i.name), meeting_link: r.meeting_link,
      });
    }
    return { from: start, to: end, tz_offset_minutes: Number(tz), total: rows.length, days };
  }

  async getById(id, actor) {
    const interview = await this._loadAuthorised(id, actor, { allowPanel: true });
    const [row] = await this._decorate([interview]);
    return row;
  }

  // iCalendar file so an interview can be dropped into any calendar app.
  async toIcs(id, actor) {
    const iv = await this.getById(id, actor);
    const fmt = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TalentSnaps//HR Interviews//EN', 'BEGIN:VEVENT',
      `UID:${iv.id}@talentsnaps`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(iv.scheduled_at)}`, `DTEND:${fmt(iv.end_at)}`,
      `SUMMARY:${esc(iv.title)}`, `LOCATION:${esc(iv.meeting_link || iv.location)}`,
      `DESCRIPTION:${esc(`Round ${iv.round} (${iv.mode}). Candidate: ${iv.candidate ? iv.candidate.full_name : ''}`)}`,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
  }
}

module.exports = new HrInterviewService();
