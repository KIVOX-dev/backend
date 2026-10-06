const hrEvaluationRepository = require('../repositories/hrEvaluation.repository');
const hrInterviewRepository = require('../repositories/hrInterview.repository');
const placementApplicationRepository = require('../repositories/placementApplication.repository');
const placementRepository = require('../repositories/placement.repository');
const { getOrgId, ownsPlacement, loadOwnedPlacement } = require('../utils/hrScope');
const { ROLES } = require('../config/constants');
const matching = require('./hrMatching.service');
const candidates = require('./hrCandidate.service');
const ApiError = require('../utils/ApiError');

const round1 = (n) => Math.round(n * 10) / 10;

// Weighted average of 1-5 ratings → 0-100.
function scorePercent(scores) {
  const totalWeight = scores.reduce((s, x) => s + (x.weight || 1), 0);
  if (!totalWeight) return null;
  const avg = scores.reduce((s, x) => s + x.rating * (x.weight || 1), 0) / totalWeight;
  return Math.round((avg / 5) * 100);
}

// Composite 0-100 used for ranking. Weights renormalise over whichever
// components exist, so a candidate with no interview yet is still comparable.
const COMPOSITE_WEIGHTS = { evaluation: 0.45, interview: 0.35, match: 0.2 };

function composite({ evaluationScore, interviewScore, matchScore }) {
  const parts = [
    ['evaluation', evaluationScore],
    ['interview', interviewScore],
    ['match', matchScore],
  ].filter(([, v]) => v !== null && v !== undefined);
  const w = parts.reduce((s, [k]) => s + COMPOSITE_WEIGHTS[k], 0);
  return w ? Math.round(parts.reduce((s, [k, v]) => s + v * COMPOSITE_WEIGHTS[k], 0) / w) : null;
}

function average(nums) {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null;
}

// Interview component: mean of every panelist rating across non-cancelled
// interviews, scaled 1-5 → 0-100.
function interviewScoreOf(interviews) {
  const ratings = interviews.filter((i) => i.status !== 'cancelled').flatMap((i) => (i.feedback || []).map((f) => f.rating));
  const avg = average(ratings);
  return avg === null ? null : Math.round((avg / 5) * 100);
}

class HrEvaluationService {
  async _loadAuthorisedApplication(applicationId, actor) {
    const application = await placementApplicationRepository.findById(applicationId);
    if (!application) throw ApiError.notFound('Application not found');
    const placement = await placementRepository.findById(application.placement_id);
    if (!placement || !(await ownsPlacement(actor, placement))) throw ApiError.forbidden('This application belongs to another recruiter\'s vacancy');
    return { application, placement };
  }

  // Create or replace the caller's scorecard for an application.
  async upsert(applicationId, data, actor) {
    const { application, placement } = await this._loadAuthorisedApplication(applicationId, actor);
    if (data.interview_id) {
      const interview = await hrInterviewRepository.findById(data.interview_id);
      if (!interview || interview.application_id !== application.id) throw ApiError.badRequest('interview_id does not belong to this application');
    }
    const payload = {
      org_id: await getOrgId(actor),
      application_id: application.id,
      placement_id: placement.id,
      student_id: application.student_id,
      evaluator_id: actor.id,
      interview_id: data.interview_id || null,
      scores: data.scores,
      score_percent: scorePercent(data.scores),
      recommendation: data.recommendation,
      strengths: data.strengths || null,
      concerns: data.concerns || null,
      notes: data.notes || null,
    };
    const existing = await hrEvaluationRepository.findOne({ application_id: application.id, evaluator_id: actor.id });
    const saved = existing ? await hrEvaluationRepository.updateById(existing.id, payload) : await hrEvaluationRepository.create(payload);
    const overall = await this.refreshApplicationScore(application.id);
    return { ...saved, application_overall_score: overall };
  }

  async remove(evaluationId, actor) {
    const evaluation = await hrEvaluationRepository.findById(evaluationId);
    if (!evaluation) throw ApiError.notFound('Evaluation not found');
    if (actor.role !== ROLES.SUPER_ADMIN && evaluation.evaluator_id !== actor.id) {
      await this._loadAuthorisedApplication(evaluation.application_id, actor); // vacancy owner may also delete
    }
    await hrEvaluationRepository.deleteById(evaluationId);
    await this.refreshApplicationScore(evaluation.application_id);
  }

  // All scorecards for an application with a cross-evaluator roll-up:
  // per-skill averages, overall average, and the recommendation tally.
  async forApplication(applicationId, actor) {
    const { application } = await this._loadAuthorisedApplication(applicationId, actor);
    const [evalDocs, interviewDocs] = await Promise.all([
      hrEvaluationRepository.collection.find({ application_id: application.id }).sort({ created_at: 1 }).toArray(),
      hrInterviewRepository.collection.find({ application_id: application.id }).toArray(),
    ]);
    const evaluations = evalDocs.map((d) => hrEvaluationRepository._toEntity(d));
    const interviews = interviewDocs.map((d) => hrInterviewRepository._toEntity(d));

    const bySkill = new Map();
    for (const ev of evaluations) {
      for (const s of ev.scores) {
        const key = s.name.toLowerCase();
        if (!bySkill.has(key)) bySkill.set(key, { name: s.name, category: s.category, ratings: [] });
        bySkill.get(key).ratings.push(s.rating);
      }
    }
    const recommendations = {};
    for (const ev of evaluations) recommendations[ev.recommendation] = (recommendations[ev.recommendation] || 0) + 1;

    const evaluationScore = average(evaluations.map((e) => e.score_percent).filter((n) => n !== null));
    const interviewScore = interviewScoreOf(interviews);
    return {
      application_id: application.id,
      evaluations,
      summary: {
        evaluator_count: evaluations.length,
        evaluation_score: evaluationScore === null ? null : Math.round(evaluationScore),
        interview_score: interviewScore,
        match_score: application.match_score ?? null,
        overall_score: composite({ evaluationScore, interviewScore, matchScore: application.match_score }),
        recommendations,
        skills: [...bySkill.values()].map((s) => ({ name: s.name, category: s.category, average_rating: round1(average(s.ratings)), evaluators: s.ratings.length })),
      },
    };
  }

  // Recomputes and stores the application's composite score. Called whenever an
  // evaluation or interview feedback changes.
  async refreshApplicationScore(applicationId) {
    const application = await placementApplicationRepository.findById(applicationId);
    if (!application) return null;
    const [evalDocs, interviewDocs] = await Promise.all([
      hrEvaluationRepository.collection.find({ application_id: applicationId }).toArray(),
      hrInterviewRepository.collection.find({ application_id: applicationId }).toArray(),
    ]);
    const evaluationScore = average(evalDocs.map((e) => e.score_percent).filter((n) => n !== null && n !== undefined));
    const interviewScore = interviewScoreOf(interviewDocs.map((d) => hrInterviewRepository._toEntity(d)));
    const overall = composite({ evaluationScore, interviewScore, matchScore: application.match_score });
    await placementApplicationRepository.updateById(applicationId, { overall_score: overall });
    return overall;
  }

  // Applicants of a vacancy ranked best-first on the composite score, with the
  // components shown so the ranking is explainable. Match scores are computed
  // on demand for anyone who doesn't have one cached yet.
  async ranking(placementId, actor, { include_rejected: includeRejected = false } = {}) {
    const placement = await loadOwnedPlacement(actor, placementId);
    let apps = await placementApplicationRepository.findByPlacementIds([placement.id]);
    apps = apps.filter((a) => a.status !== 'withdrawn' && (includeRejected === true || includeRejected === 'true' || a.status !== 'rejected'));
    await matching.scoreApplications(placement, apps);

    const ids = apps.map((a) => a.id);
    const [evalDocs, interviewDocs, summaries] = await Promise.all([
      ids.length ? hrEvaluationRepository.collection.find({ application_id: { $in: ids } }).toArray() : [],
      ids.length ? hrInterviewRepository.collection.find({ application_id: { $in: ids } }).toArray() : [],
      candidates.summaries(apps.map((a) => a.student_id)),
    ]);
    const evalsByApp = new Map();
    const interviewsByApp = new Map();
    for (const d of evalDocs) (evalsByApp.get(d.application_id) || evalsByApp.set(d.application_id, []).get(d.application_id)).push(d);
    for (const d of interviewDocs) (interviewsByApp.get(d.application_id) || interviewsByApp.set(d.application_id, []).get(d.application_id)).push(hrInterviewRepository._toEntity(d));

    const rows = apps.map((a) => {
      const evs = evalsByApp.get(a.id) || [];
      const evaluationScore = average(evs.map((e) => e.score_percent).filter((n) => n !== null && n !== undefined));
      const interviewScore = interviewScoreOf(interviewsByApp.get(a.id) || []);
      const recs = {};
      for (const e of evs) recs[e.recommendation] = (recs[e.recommendation] || 0) + 1;
      return {
        application_id: a.id,
        status: a.status,
        candidate: summaries.get(a.student_id) || null,
        match_score: a.match_score ?? null,
        evaluation_score: evaluationScore === null ? null : Math.round(evaluationScore),
        interview_score: interviewScore,
        overall_score: composite({ evaluationScore, interviewScore, matchScore: a.match_score }),
        evaluator_count: evs.length,
        recommendations: recs,
      };
    });
    rows.sort((a, b) => (b.overall_score ?? -1) - (a.overall_score ?? -1) || (b.match_score ?? -1) - (a.match_score ?? -1));
    // Competition ranking: equal scores share a rank.
    let lastScore = null;
    let lastRank = 0;
    rows.forEach((r, i) => {
      if (r.overall_score !== lastScore) {
        lastRank = i + 1;
        lastScore = r.overall_score;
      }
      r.rank = lastRank;
    });
    return { placement_id: placement.id, title: placement.title, weights: COMPOSITE_WEIGHTS, rows };
  }
}

module.exports = new HrEvaluationService();
module.exports.scorePercent = scorePercent;
module.exports.composite = composite;
