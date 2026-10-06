const placementApplicationRepository = require('../repositories/placementApplication.repository');
const studentRepository = require('../repositories/student.repository');
const hrTalentPoolRepository = require('../repositories/hrTalentPool.repository');
const { SKILLS } = require('../config/skillCatalog');
const { matchCandidate, toSkillNames, uniqueSkills } = require('../utils/candidateMatching');
const { loadOwnedPlacement, getOrgId } = require('../utils/hrScope');
const { escapeRegex } = require('../utils/regex');
const candidates = require('./hrCandidate.service');
const ApiError = require('../utils/ApiError');

// Skills named in a posting's free-text description, via the curated catalog.
// Only used when the recruiter listed no required_skills explicitly.
function inferSkillsFromText(text) {
  if (!text) return [];
  const found = [];
  for (const skill of SKILLS) {
    if (skill.keywords.some((k) => new RegExp(`(^|[^a-z0-9])${escapeRegex(k)}([^a-z0-9]|$)`, 'i').test(text))) found.push(skill.name);
  }
  return found;
}

function jobRequirements(placement) {
  const explicit = uniqueSkills(toSkillNames(placement.required_skills));
  const required = explicit.length ? explicit : inferSkillsFromText(`${placement.title || ''} ${placement.description || ''}`);
  return { ...placement, required_skills: required, _skills_inferred: explicit.length === 0 && required.length > 0 };
}

class HrMatchingService {
  // Scores applications against their vacancy and caches the result on the
  // application (match_score/match_details) so lists can sort/filter on it.
  // Cached values are reused unless `force` or the cache is missing.
  async scoreApplications(placement, applications, { force = false } = {}) {
    const job = jobRequirements(placement);
    const stale = applications.filter((a) => force || a.match_score === undefined || a.match_score === null);
    const profiles = stale.length ? await candidates.matchingProfiles(stale.map((a) => a.student_id)) : new Map();

    const results = new Map();
    for (const app of applications) {
      if (!stale.includes(app)) {
        results.set(app.id, { match_score: app.match_score, ...(app.match_details || {}) });
        continue;
      }
      const profile = profiles.get(app.student_id);
      if (!profile) continue;
      const details = matchCandidate(job, profile);
      await placementApplicationRepository.updateById(app.id, { match_score: details.match_score, match_details: details });
      app.match_score = details.match_score;
      app.match_details = details;
      results.set(app.id, details);
    }
    return results;
  }

  // Resume-vs-JD report for one application (recomputed on request).
  async matchForApplication(applicationId, actor) {
    const app = await placementApplicationRepository.findById(applicationId);
    if (!app) throw ApiError.notFound('Application not found');
    const placement = await loadOwnedPlacement(actor, app.placement_id);
    const results = await this.scoreApplications(placement, [app], { force: true });
    return { application_id: app.id, placement_id: placement.id, required_skills: jobRequirements(placement).required_skills, ...results.get(app.id) };
  }

  // Recomputes the match for every applicant of a vacancy and returns them
  // best-first.
  async matchApplicants(placementId, actor, { force = true } = {}) {
    const placement = await loadOwnedPlacement(actor, placementId);
    const apps = await placementApplicationRepository.findByPlacementIds([placement.id]);
    const results = await this.scoreApplications(placement, apps, { force });
    const summaries = await candidates.summaries(apps.map((a) => a.student_id));
    return apps
      .filter((a) => results.has(a.id))
      .map((a) => ({ application_id: a.id, status: a.status, candidate: summaries.get(a.student_id), ...results.get(a.id) }))
      .sort((a, b) => b.match_score - a.match_score);
  }

  // Candidates worth reaching out to. scope=applicants only ranks people who
  // already applied; scope=platform also searches profile-complete students on
  // the platform (limited to the vacancy's own institution when it has one),
  // exposing contact details only for people the recruiter already has a
  // relationship with (an applicant or a talent-pool save).
  async recommend(placementId, actor, { limit = 20, min_score: minScore = 0, scope = 'platform', only_eligible: onlyEligible = true, page_pool: pool = 400 } = {}) {
    const placement = await loadOwnedPlacement(actor, placementId);
    const job = jobRequirements(placement);
    const apps = await placementApplicationRepository.findByPlacementIds([placement.id]);
    const appByStudent = new Map(apps.map((a) => [a.student_id, a]));
    const orgId = await getOrgId(actor);
    const pooled = orgId
      ? await hrTalentPoolRepository.collection.find({ org_id: orgId, status: { $ne: 'archived' } }).project({ student_id: 1 }).toArray()
      : [];
    const pooledIds = new Set(pooled.map((p) => p.student_id));

    let studentIds = apps.filter((a) => !['withdrawn'].includes(a.status)).map((a) => a.student_id);
    if (scope === 'platform') {
      const filter = { profile_completed: true };
      if (placement.institution_id) filter.institution_id = placement.institution_id;
      if (placement.min_cgpa && onlyEligible) filter.cgpa = { $gte: Number(placement.min_cgpa) };
      if (Array.isArray(placement.eligible_years) && placement.eligible_years.length && onlyEligible) filter.batch_year = { $in: placement.eligible_years.map(Number) };
      const docs = await studentRepository.collection.find(filter).project({ _id: 1 }).sort({ updated_at: -1 }).limit(Math.min(Number(pool) || 400, 1000)).toArray();
      studentIds = [...new Set([...studentIds, ...docs.map((d) => d._id)])];
    }
    if (studentIds.length === 0) return { placement_id: placement.id, skills_inferred: job._skills_inferred, required_skills: job.required_skills, candidates: [] };

    const [profiles, summaries] = await Promise.all([candidates.matchingProfiles(studentIds), candidates.summaries(studentIds)]);
    const out = [];
    for (const id of studentIds) {
      const profile = profiles.get(id);
      const summary = summaries.get(id);
      if (!profile || !summary) continue;
      const m = matchCandidate(job, profile);
      if (onlyEligible && !m.eligible) continue;
      if (m.match_score < Number(minScore)) continue;
      const app = appByStudent.get(id);
      const known = Boolean(app) || pooledIds.has(id);
      const { email, phone, resume_url: resumeUrl, ...anonymous } = summary;
      out.push({
        ...(known ? summary : anonymous),
        skills: profile.skills.slice(0, 25),
        already_applied: Boolean(app),
        application_id: app ? app.id : null,
        application_status: app ? app.status : null,
        in_talent_pool: pooledIds.has(id),
        ...m,
      });
    }
    out.sort((a, b) => b.match_score - a.match_score);
    return {
      placement_id: placement.id,
      required_skills: job.required_skills,
      skills_inferred: job._skills_inferred,
      total_considered: studentIds.length,
      candidates: out.slice(0, Math.min(Number(limit) || 20, 100)),
    };
  }
}

module.exports = new HrMatchingService();
module.exports.inferSkillsFromText = inferSkillsFromText;
module.exports.jobRequirements = jobRequirements;
