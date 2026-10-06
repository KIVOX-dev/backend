const placementApplicationRepository = require('../repositories/placementApplication.repository');
const placementRepository = require('../repositories/placement.repository');
const notificationRepository = require('../repositories/notification.repository');
const hrInterviewRepository = require('../repositories/hrInterview.repository');
const hrEvaluationRepository = require('../repositories/hrEvaluation.repository');
const studentRepository = require('../repositories/student.repository');
const { PIPELINE_STAGES, ALL_STATUSES, TERMINAL, STAGE_TIMESTAMP, SOURCES } = require('../utils/hrPipeline');
const { ROLES } = require('../config/constants');
const { loadOwnedPlacement, ownedPlacements, ownsPlacement } = require('../utils/hrScope');
const { escapeRegex } = require('../utils/regex');
const candidates = require('./hrCandidate.service');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const NOTIFY = {
  shortlisted: (job) => ({ title: 'You have been shortlisted', message: `You've been shortlisted for ${job}.` }),
  selected: (job) => ({ title: 'You have been selected', message: `Congratulations! You've been selected for ${job}.` }),
  hired: (job) => ({ title: 'Welcome aboard', message: `You've been hired for ${job}. HR will share joining details soon.` }),
  rejected: (job) => ({ title: 'Application update', message: `Thank you for applying to ${job}. We won't be moving forward with your application this time.` }),
};

class HrPipelineService {
  // Core transition. Appends to stage_history, stamps the stage's first-entry
  // timestamp, notifies the student, and — on `hired` — opens an employee
  // record with an onboarding checklist. Callers have already authorised.
  async applyTransition(application, toStatus, actor, { note, reason, hire } = {}) {
    if (!ALL_STATUSES.includes(toStatus)) throw ApiError.badRequest(`Unknown stage '${toStatus}'`);
    if (application.status === toStatus) return application;
    if (TERMINAL.includes(application.status)) {
      throw ApiError.conflict(`This application is already ${application.status} and can no longer change stage`);
    }
    if (toStatus === 'rejected' && !reason && !note) {
      // A reason isn't mandatory, but record "no reason given" explicitly so
      // analytics can distinguish it from a missing field.
      reason = 'unspecified';
    }

    const now = new Date();
    const patch = {
      status: toStatus,
      stage_history: [
        ...(application.stage_history || []),
        { from: application.status, to: toStatus, at: now, by: actor.id, ...(note ? { note } : {}), ...(reason && toStatus === 'rejected' ? { reason } : {}) },
      ],
    };
    const stamp = STAGE_TIMESTAMP[toStatus];
    if (stamp && !application[stamp]) patch[stamp] = now;
    if (toStatus === 'rejected') patch.rejection_reason = reason;
    if (toStatus !== 'rejected' && application.rejection_reason) patch.rejection_reason = null; // reopened
    if (note) patch.notes = note;

    const updated = await placementApplicationRepository.updateById(application.id, patch);
    await this._notify(updated, toStatus);

    if (toStatus === 'hired') {
      const employeeService = require('./hrEmployee.service'); // lazy: employee service depends on this module's repositories
      await employeeService.createFromApplication(updated, actor, hire || {});
    }
    return updated;
  }

  async _notify(application, toStatus) {
    const build = NOTIFY[toStatus];
    if (!build) return;
    try {
      const student = await studentRepository.findById(application.student_id);
      const placement = await placementRepository.findById(application.placement_id);
      if (!student || !placement) return;
      const { title, message } = build(`${placement.title}${placement.company_name ? ` at ${placement.company_name}` : ''}`);
      await notificationRepository.create({ user_id: student.user_id, title, message, type: 'placement' });
    } catch (err) {
      logger.error('Failed to notify student of stage change', { error: err.message, applicationId: application.id });
    }
  }

  async _loadAuthorised(applicationId, actor) {
    const application = await placementApplicationRepository.findById(applicationId);
    if (!application) throw ApiError.notFound('Application not found');
    const placement = await placementRepository.findById(application.placement_id);
    if (!placement) throw ApiError.notFound('Vacancy for this application no longer exists');
    if (!(await ownsPlacement(actor, placement))) throw ApiError.forbidden('This application belongs to another recruiter\'s vacancy');
    return { application, placement };
  }

  async moveStage(applicationId, toStatus, actor, opts = {}) {
    const { application } = await this._loadAuthorised(applicationId, actor);
    return this.applyTransition(application, toStatus, actor, opts);
  }

  // Bulk move; reports per-application outcome instead of failing the batch.
  async bulkMove(applicationIds, toStatus, actor, opts = {}) {
    const results = [];
    for (const id of [...new Set(applicationIds)]) {
      try {
        const updated = await this.moveStage(id, toStatus, actor, opts);
        results.push({ id, ok: true, status: updated.status });
      } catch (err) {
        results.push({ id, ok: false, error: err.message });
      }
    }
    return { moved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  async addNote(applicationId, note, actor) {
    const { application } = await this._loadAuthorised(applicationId, actor);
    const history = [...(application.stage_history || []), { from: application.status, to: application.status, at: new Date(), by: actor.id, note, type: 'note' }];
    return placementApplicationRepository.updateById(application.id, { notes: note, stage_history: history });
  }

  _summaryRow(app, summary, job) {
    return {
      id: app.id,
      placement_id: app.placement_id,
      job_title: job ? job.title : null,
      student_id: app.student_id,
      status: app.status,
      source: app.source || 'direct_application',
      match_score: app.match_score ?? null,
      overall_score: app.overall_score ?? null,
      rejection_reason: app.rejection_reason || null,
      notes: app.notes || null,
      applied_at: app.created_at,
      updated_at: app.updated_at,
      candidate: summary || null,
    };
  }

  // Kanban data for one vacancy: a column per stage, each with its candidates.
  async board(placementId, actor) {
    const placement = await loadOwnedPlacement(actor, placementId);
    const apps = await placementApplicationRepository.findByPlacementIds([placement.id]);
    const summaries = await candidates.summaries(apps.map((a) => a.student_id));
    const columns = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, []]));
    for (const app of apps) {
      const col = columns[app.status];
      if (col) col.push(this._summaryRow(app, summaries.get(app.student_id), placement));
    }
    for (const stage of PIPELINE_STAGES) {
      columns[stage].sort((a, b) => (b.overall_score ?? b.match_score ?? -1) - (a.overall_score ?? a.match_score ?? -1));
    }
    const withdrawn = apps.filter((a) => a.status === 'withdrawn').length;
    return {
      placement: { id: placement.id, title: placement.title, status: placement.status, openings: placement.openings || null },
      stages: PIPELINE_STAGES,
      counts: { ...Object.fromEntries(PIPELINE_STAGES.map((s) => [s, columns[s].length])), withdrawn, total: apps.length },
      columns,
    };
  }

  // Filterable, paginated applicants across every vacancy the actor manages.
  async listApplications(actor, query = {}) {
    const { placement_id: placementId, status, source, search, min_match: minMatch, page: p, limit: l, sort } = query;
    const page = Math.max(parseInt(p, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(l, 10) || 20, 1), 100);

    const placements = await ownedPlacements(actor);
    let ids = placements.map((x) => x.id);
    if (placementId) {
      if (!ids.includes(placementId)) throw ApiError.forbidden('That vacancy is not yours');
      ids = [placementId];
    }
    if (ids.length === 0) return { rows: [], meta: { page, limit, total: 0 } };

    const filter = { placement_id: { $in: ids } };
    if (status) filter.status = status;
    if (source) filter.source = source;
    if (minMatch) filter.match_score = { $gte: Number(minMatch) };
    if (search) {
      const safe = escapeRegex(String(search));
      const users = await require('../repositories/user.repository').collection
        .find({ role: ROLES.STUDENT, $or: [{ full_name: { $regex: safe, $options: 'i' } }, { email: { $regex: safe, $options: 'i' } }] })
        .project({ _id: 1 }).limit(500).toArray();
      const studs = await candidates.findMany(studentRepository, 'user_id', users.map((u) => u._id));
      filter.student_id = { $in: studs.map((s) => s.id) };
    }

    const sortSpec = sort === 'match' ? { match_score: -1, created_at: -1 } : sort === 'score' ? { overall_score: -1, created_at: -1 } : { created_at: -1 };
    const [docs, total] = await Promise.all([
      placementApplicationRepository.collection.find(filter).sort(sortSpec).skip((page - 1) * limit).limit(limit).toArray(),
      placementApplicationRepository.collection.countDocuments(filter),
    ]);
    const apps = docs.map((d) => placementApplicationRepository._toEntity(d));
    const summaries = await candidates.summaries(apps.map((a) => a.student_id));
    const jobById = new Map(placements.map((x) => [x.id, x]));
    return { rows: apps.map((a) => this._summaryRow(a, summaries.get(a.student_id), jobById.get(a.placement_id))), meta: { page, limit, total } };
  }

  // Everything HR needs on one candidate for one application.
  async detail(applicationId, actor) {
    const { application, placement } = await this._loadAuthorised(applicationId, actor);
    const [summaries, profiles, interviews, evaluations] = await Promise.all([
      candidates.summaries([application.student_id]),
      candidates.matchingProfiles([application.student_id]),
      hrInterviewRepository.collection.find({ application_id: application.id }).sort({ scheduled_at: 1 }).toArray(),
      hrEvaluationRepository.collection.find({ application_id: application.id }).sort({ created_at: -1 }).toArray(),
    ]);
    const profile = profiles.get(application.student_id);
    return {
      ...this._summaryRow(application, summaries.get(application.student_id), placement),
      stage_history: application.stage_history || [],
      match_details: application.match_details || null,
      skills: profile ? profile.skills : [],
      experience_years: profile ? Math.round((profile.experience_months / 12) * 10) / 10 : 0,
      interviews: interviews.map((d) => hrInterviewRepository._toEntity(d)),
      evaluations: evaluations.map((d) => hrEvaluationRepository._toEntity(d)),
    };
  }

  static get SOURCES() {
    return SOURCES;
  }
}

module.exports = new HrPipelineService();
