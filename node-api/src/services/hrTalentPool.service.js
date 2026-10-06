const hrTalentPoolRepository = require('../repositories/hrTalentPool.repository');
const placementApplicationRepository = require('../repositories/placementApplication.repository');
const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const { getOrgId, loadOwnedPlacement } = require('../utils/hrScope');
const { escapeRegex } = require('../utils/regex');
const { normalizeSkill, matchCandidate } = require('../utils/candidateMatching');
const candidates = require('./hrCandidate.service');
const hrPipeline = require('./hrPipeline.service');
const { jobRequirements } = require('./hrMatching.service');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');

const clean = (list = []) => [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];

class HrTalentPoolService {
  async _entry(id, actor) {
    const entry = await hrTalentPoolRepository.findById(id);
    if (!entry) throw ApiError.notFound('Talent pool entry not found');
    const orgId = await getOrgId(actor);
    if (orgId && entry.org_id !== orgId) throw ApiError.forbidden('This entry belongs to another organisation');
    return entry;
  }

  // Saves a candidate. Pass student_id directly, or application_id to save an
  // applicant (skills/source are captured from the profile at save time).
  async add(data, actor) {
    const orgId = await getOrgId(actor);
    if (!orgId) throw ApiError.badRequest('A talent pool belongs to an HR organisation — act as an HR user');

    let studentId = data.student_id;
    let sourcePlacement = data.source_placement_id || null;
    if (data.application_id) {
      const app = await placementApplicationRepository.findById(data.application_id);
      if (!app) throw ApiError.notFound('Application not found');
      await loadOwnedPlacement(actor, app.placement_id);
      studentId = app.student_id;
      sourcePlacement = app.placement_id;
    }
    const student = await studentRepository.findById(studentId);
    if (!student) throw ApiError.badRequest('student_id does not reference a valid student');

    if (await hrTalentPoolRepository.findOne({ org_id: orgId, student_id: studentId })) {
      throw ApiError.conflict('This candidate is already in your talent pool');
    }
    const profiles = await candidates.matchingProfiles([studentId]);
    const profile = profiles.get(studentId);
    const skills = data.skills && data.skills.length ? clean(data.skills) : profile ? profile.skills : [];

    return hrTalentPoolRepository.create({
      org_id: orgId,
      student_id: studentId,
      added_by: actor.id,
      category: data.category || null,
      tags: clean(data.tags),
      skills,
      rating: data.rating || null,
      notes: data.notes || null,
      source_placement_id: sourcePlacement,
    });
  }

  async update(id, data, actor) {
    await this._entry(id, actor);
    const patch = {};
    for (const k of ['category', 'rating', 'notes', 'status']) if (data[k] !== undefined) patch[k] = data[k];
    if (data.tags) patch.tags = clean(data.tags);
    if (data.skills) patch.skills = clean(data.skills);
    if (data.status === 'contacted') patch.last_contacted_at = new Date();
    return hrTalentPoolRepository.updateById(id, patch);
  }

  async remove(id, actor) {
    await this._entry(id, actor);
    await hrTalentPoolRepository.deleteById(id);
  }

  async get(id, actor) {
    const entry = await this._entry(id, actor);
    const [summaries, profiles] = await Promise.all([candidates.summaries([entry.student_id]), candidates.matchingProfiles([entry.student_id])]);
    return { ...entry, candidate: summaries.get(entry.student_id) || null, current_skills: profiles.get(entry.student_id)?.skills || [] };
  }

  // Search + filter the saved pool. q matches name/email/tags/notes; filters
  // narrow by category, tag, skill, status, rating, cgpa, department and batch.
  async list(actor, query = {}) {
    const orgId = await getOrgId(actor);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const filter = orgId ? { org_id: orgId } : {};
    filter.status = query.status ? query.status : { $ne: 'archived' };
    if (query.category) filter.category = query.category;
    if (query.tag) filter.tags = { $regex: `^${escapeRegex(String(query.tag))}$`, $options: 'i' };
    if (query.skill) {
      const wanted = String(query.skill).split(',').map(normalizeSkill).filter(Boolean);
      filter.$and = [...(filter.$and || []), ...wanted.map((w) => ({ skills: { $elemMatch: { $regex: `^${escapeRegex(w)}`, $options: 'i' } } }))];
    }
    if (query.min_rating) filter.rating = { $gte: Number(query.min_rating) };

    // Student-side filters need the student/user documents; resolve to ids first.
    const must = [];
    if (query.min_cgpa || query.batch_year || query.department) {
      const sf = {};
      if (query.min_cgpa) sf.cgpa = { $gte: Number(query.min_cgpa) };
      if (query.batch_year) sf.batch_year = Number(query.batch_year);
      if (query.department) {
        const deptUsers = await userRepository.collection.find({ role: ROLES.STUDENT, department: query.department }).project({ _id: 1 }).limit(5000).toArray();
        sf.user_id = { $in: deptUsers.map((u) => u._id) };
      }
      const studs = await studentRepository.collection.find(sf).project({ _id: 1 }).limit(5000).toArray();
      must.push({ student_id: { $in: studs.map((x) => x._id) } });
    }
    if (query.q) {
      // q matches the student's name/email, or the entry's own tags/notes/category.
      const safe = escapeRegex(String(query.q));
      const users = await userRepository.collection
        .find({ role: ROLES.STUDENT, $or: [{ full_name: { $regex: safe, $options: 'i' } }, { email: { $regex: safe, $options: 'i' } }] })
        .project({ _id: 1 }).limit(2000).toArray();
      const matched = await studentRepository.collection.find({ user_id: { $in: users.map((u) => u._id) } }).project({ _id: 1 }).limit(2000).toArray();
      must.push({ $or: [{ student_id: { $in: matched.map((x) => x._id) } }, { tags: { $regex: safe, $options: 'i' } }, { notes: { $regex: safe, $options: 'i' } }, { category: { $regex: safe, $options: 'i' } }] });
    }
    if (must.length) filter.$and = [...(filter.$and || []), ...must];

    const [docs, total] = await Promise.all([
      hrTalentPoolRepository.collection.find(filter).sort({ rating: -1, created_at: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      hrTalentPoolRepository.collection.countDocuments(filter),
    ]);
    const rows = docs.map((d) => hrTalentPoolRepository._toEntity(d));
    const summaries = await candidates.summaries(rows.map((r) => r.student_id));
    return { rows: rows.map((r) => ({ ...r, candidate: summaries.get(r.student_id) || null })), meta: { page, limit, total } };
  }

  // Counts by category / tag / skill, to drive the filter sidebar.
  async facets(actor) {
    const orgId = await getOrgId(actor);
    const match = { ...(orgId ? { org_id: orgId } : {}), status: { $ne: 'archived' } };
    const group = async (field, unwind) => {
      const pipeline = [{ $match: match }, ...(unwind ? [{ $unwind: `$${field}` }] : []), { $group: { _id: `$${field}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 50 }];
      const rows = await hrTalentPoolRepository.collection.aggregate(pipeline).toArray();
      return rows.filter((r) => r._id).map((r) => ({ name: r._id, count: r.count }));
    };
    const [categories, tags, skills, total] = await Promise.all([group('category'), group('tags', true), group('skills', true), hrTalentPoolRepository.collection.countDocuments(match)]);
    return { total, categories, tags, skills };
  }

  // Reuse a saved candidate for a new vacancy: shortlists them against it,
  // recording the talent pool as the source and the vacancy on the entry.
  async assignToVacancy(id, placementId, actor, { note } = {}) {
    const entry = await this._entry(id, actor);
    const placement = await loadOwnedPlacement(actor, placementId);
    if (['closed', 'cancelled'].includes(placement.status)) throw ApiError.conflict(`This vacancy is ${placement.status}`);
    const student = await studentRepository.findById(entry.student_id);
    if (!student) throw ApiError.notFound('This candidate no longer exists');

    let application = await placementApplicationRepository.findOne({ placement_id: placementId, student_id: entry.student_id });
    if (application) {
      if (application.status === 'applied' || application.status === 'screening') {
        application = await hrPipeline.applyTransition(application, 'shortlisted', actor, { note: note || 'Shortlisted from talent pool' });
      }
    } else {
      application = await placementApplicationRepository.create({
        placement_id: placementId,
        student_id: entry.student_id,
        institution_id: student.institution_id,
        recruiter_id: placement.recruiter_id || actor.id,
        source: 'talent_pool',
        status: 'shortlisted',
        shortlisted_at: new Date(),
        stage_history: [{ from: null, to: 'shortlisted', at: new Date(), by: actor.id, note: note || 'Added from talent pool' }],
      });
    }
    const used = [...new Set([...(entry.used_in_placements || []), placementId])];
    await hrTalentPoolRepository.updateById(id, { used_in_placements: used, status: 'contacted', last_contacted_at: new Date() });
    return application;
  }

  // Which saved candidates best fit a vacancy — the "reuse for future
  // vacancies" lookup.
  async matchesForVacancy(placementId, actor, { limit = 20 } = {}) {
    const placement = await loadOwnedPlacement(actor, placementId);
    const orgId = await getOrgId(actor);
    const filter = { ...(orgId ? { org_id: orgId } : {}), status: { $ne: 'archived' } };
    const docs = await hrTalentPoolRepository.collection.find(filter).limit(1000).toArray();
    const entries = docs.map((d) => hrTalentPoolRepository._toEntity(d));
    if (entries.length === 0) return { placement_id: placementId, candidates: [] };
    const [profiles, summaries] = await Promise.all([candidates.matchingProfiles(entries.map((e) => e.student_id)), candidates.summaries(entries.map((e) => e.student_id))]);
    const job = jobRequirements(placement);
    const rows = entries
      .map((e) => {
        const profile = profiles.get(e.student_id);
        if (!profile) return null;
        return { entry_id: e.id, category: e.category, tags: e.tags, rating: e.rating, already_used: (e.used_in_placements || []).includes(placementId), candidate: summaries.get(e.student_id), ...matchCandidate(job, profile) };
      })
      .filter(Boolean)
      .sort((a, b) => b.match_score - a.match_score);
    return { placement_id: placementId, candidates: rows.slice(0, Math.min(Number(limit) || 20, 100)) };
  }

  // Student directory search for adding people to the pool — only profile-complete
  // students, with contact details withheld until they're saved.
  async searchStudents(actor, { q, skill, department, min_cgpa: minCgpa, limit = 20 }) {
    const uf = { role: ROLES.STUDENT };
    if (department) uf.department = department;
    if (q) {
      const safe = escapeRegex(String(q));
      uf.full_name = { $regex: safe, $options: 'i' };
    }
    const users = await userRepository.collection.find(uf).project({ _id: 1 }).limit(500).toArray();
    const sf = { profile_completed: true, user_id: { $in: users.map((u) => u._id) } };
    if (minCgpa) sf.cgpa = { $gte: Number(minCgpa) };
    const studs = await studentRepository.collection.find(sf).project({ _id: 1 }).limit(200).toArray();
    const ids = studs.map((s) => s._id);
    const [summaries, profiles] = await Promise.all([candidates.summaries(ids, { includeContact: false }), candidates.matchingProfiles(ids)]);
    const wanted = skill ? String(skill).split(',').map(normalizeSkill).filter(Boolean) : [];
    const rows = ids
      .map((id) => ({ ...summaries.get(id), skills: (profiles.get(id)?.skills || []).slice(0, 20) }))
      .filter((r) => r.student_id && wanted.every((w) => r.skills.some((s) => normalizeSkill(s) === w)));
    return rows.slice(0, Math.min(Number(limit) || 20, 50));
  }
}

module.exports = new HrTalentPoolService();
