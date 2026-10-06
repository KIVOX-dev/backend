const { randomUUID } = require('node:crypto');
const hrEmployeeRepository = require('../repositories/hrEmployee.repository');
const placementRepository = require('../repositories/placement.repository');
const notificationRepository = require('../repositories/notification.repository');
const studentRepository = require('../repositories/student.repository');
const { getOrgId } = require('../utils/hrScope');
const { escapeRegex } = require('../utils/regex');
const employeeDocStorage = require('../utils/employeeDocStorage');
const { sign } = require('../utils/signedUrl');
const { securityEvent, EVENTS } = require('../utils/securityLog');
const candidates = require('./hrCandidate.service');
const ApiError = require('../utils/ApiError');

const DEFAULT_ONBOARDING = [
  { title: 'Sign offer letter and employment contract', category: 'documents', due_in_days: 0 },
  { title: 'Submit ID proof, address proof and photographs', category: 'documents', due_in_days: 3 },
  { title: 'Submit educational certificates and previous employment records', category: 'documents', due_in_days: 7 },
  { title: 'Bank and statutory (PF/tax) details collected', category: 'compliance', due_in_days: 7 },
  { title: 'Issue laptop and workplace access', category: 'it', due_in_days: 1 },
  { title: 'Create company email and tool accounts', category: 'it', due_in_days: 1 },
  { title: 'Orientation and company policy walkthrough', category: 'orientation', due_in_days: 2 },
  { title: 'Meet manager and team; assign buddy', category: 'orientation', due_in_days: 2 },
  { title: 'Set 30-60-90 day goals', category: 'performance', due_in_days: 14 },
];

const progressOf = (tasks) => (tasks.length ? Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100) : 0);
const DAY = 24 * 60 * 60 * 1000;

class HrEmployeeService {
  async _load(id, actor) {
    const employee = await hrEmployeeRepository.findById(id);
    if (!employee) throw ApiError.notFound('Employee not found');
    const orgId = await getOrgId(actor);
    if (orgId && employee.org_id !== orgId) throw ApiError.forbidden('This employee belongs to another organisation');
    return employee;
  }

  async _nextCode(orgId) {
    let n = (await hrEmployeeRepository.collection.countDocuments({ org_id: orgId })) + 1;
    // Codes can collide after deletions; walk forward to the first free one.
    for (;;) {
      const code = `EMP-${String(n).padStart(4, '0')}`;
      if (!(await hrEmployeeRepository.findOne({ org_id: orgId, employee_code: code }))) return code;
      n += 1;
    }
  }

  _tasksFromTemplate(joinDate, template = DEFAULT_ONBOARDING) {
    const base = joinDate ? new Date(joinDate).getTime() : Date.now();
    return template.map((t) => ({
      id: randomUUID(), title: t.title, category: t.category || 'general',
      due_date: new Date(base + (t.due_in_days || 0) * DAY), status: 'pending', completed_at: null, assignee: null,
    }));
  }

  _onboarding(tasks) {
    return { tasks, progress: progressOf(tasks) };
  }

  async create(data, actor) {
    const orgId = await getOrgId(actor);
    if (!orgId) throw ApiError.badRequest('Employees belong to an HR organisation — act as an HR user');
    if (data.email && (await hrEmployeeRepository.findOne({ org_id: orgId, email: data.email.toLowerCase() }))) {
      throw ApiError.conflict('An employee with this email already exists');
    }
    const tasks = data.skip_onboarding_template ? [] : this._tasksFromTemplate(data.join_date);
    const { skip_onboarding_template: _skip, ...fields } = data;
    return hrEmployeeRepository.create({
      ...fields,
      email: data.email ? data.email.toLowerCase() : null,
      org_id: orgId,
      created_by: actor.id,
      employee_code: await this._nextCode(orgId),
      status: data.status || 'onboarding',
      onboarding: this._onboarding(tasks),
    });
  }

  // Converts a hired candidate into an employee with the standard onboarding
  // checklist. Idempotent per application.
  async createFromApplication(application, actor, opts = {}) {
    const existing = await hrEmployeeRepository.findOne({ application_id: application.id });
    if (existing) return existing;
    const placement = await placementRepository.findById(application.placement_id);
    const orgId = (await getOrgId(actor)) || (placement && (placement.company_id || placement.recruiter_id));
    if (!orgId) return null;
    const summaries = await candidates.summaries([application.student_id]);
    const c = summaries.get(application.student_id);
    if (!c) return null;
    const profiles = await candidates.matchingProfiles([application.student_id]);
    const joinDate = opts.join_date ? new Date(opts.join_date) : null;

    const employee = await hrEmployeeRepository.create({
      org_id: orgId,
      created_by: actor.id,
      employee_code: await this._nextCode(orgId),
      user_id: c.user_id,
      student_id: application.student_id,
      application_id: application.id,
      placement_id: application.placement_id,
      full_name: c.full_name,
      email: c.email ? c.email.toLowerCase() : null,
      phone: c.phone || null,
      designation: opts.designation || (placement && placement.title) || null,
      department: opts.department || c.department || null,
      employment_type: opts.employment_type || (placement && placement.job_type) || 'full_time',
      location: opts.location || (placement && placement.location) || null,
      manager_name: opts.manager_name || null,
      join_date: joinDate,
      status: 'onboarding',
      skills: (profiles.get(application.student_id)?.skills || []).map((name) => ({ name, level: null })),
      onboarding: this._onboarding(this._tasksFromTemplate(joinDate)),
    });

    try {
      const student = await studentRepository.findById(application.student_id);
      if (student) {
        await notificationRepository.create({
          user_id: student.user_id, title: 'Onboarding started',
          message: `Your onboarding${joinDate ? ` (joining ${joinDate.toDateString()})` : ''} has begun. Check your email for next steps.`, type: 'placement',
        });
      }
    } catch { /* notification is best-effort */ }
    return employee;
  }

  async list(actor, query = {}) {
    const orgId = await getOrgId(actor);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const filter = orgId ? { org_id: orgId } : {};
    for (const k of ['status', 'department', 'employment_type']) if (query[k]) filter[k] = query[k];
    if (query.q) {
      const safe = escapeRegex(String(query.q));
      filter.$or = ['full_name', 'email', 'employee_code', 'designation'].map((f) => ({ [f]: { $regex: safe, $options: 'i' } }));
    }
    const [docs, total] = await Promise.all([
      hrEmployeeRepository.collection.find(filter, { projection: { documents: 0, performance_reviews: 0 } }).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      hrEmployeeRepository.collection.countDocuments(filter),
    ]);
    return { rows: docs.map((d) => hrEmployeeRepository._toEntity(d)), meta: { page, limit, total } };
  }

  async get(id, actor) {
    return this._load(id, actor);
  }

  async update(id, data, actor) {
    const employee = await this._load(id, actor);
    const patch = { ...data };
    if (patch.email) patch.email = patch.email.toLowerCase();
    if (data.status === 'exited' && !data.exit_date && !employee.exit_date) patch.exit_date = new Date();
    return hrEmployeeRepository.updateById(id, patch);
  }

  async remove(id, actor) {
    const employee = await this._load(id, actor);
    for (const doc of employee.documents || []) await employeeDocStorage.remove(doc.url).catch(() => {});
    await hrEmployeeRepository.deleteById(id);
  }

  // ---- onboarding ----
  async _saveTasks(employee, tasks) {
    const patch = { onboarding: this._onboarding(tasks) };
    if (tasks.length && patch.onboarding.progress === 100 && employee.status === 'onboarding') patch.status = 'active';
    if (employee.status === 'active' && tasks.length && patch.onboarding.progress < 100 && employee.onboarding?.progress === 100) patch.status = 'onboarding';
    return hrEmployeeRepository.updateById(employee.id, patch);
  }

  async addTask(id, data, actor) {
    const employee = await this._load(id, actor);
    const task = { id: randomUUID(), title: data.title, category: data.category || 'general', due_date: data.due_date ? new Date(data.due_date) : null, status: 'pending', completed_at: null, assignee: data.assignee || null };
    return this._saveTasks(employee, [...(employee.onboarding?.tasks || []), task]);
  }

  async updateTask(id, taskId, data, actor) {
    const employee = await this._load(id, actor);
    const tasks = employee.onboarding?.tasks || [];
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) throw ApiError.notFound('Onboarding task not found');
    const t = { ...tasks[idx], ...data };
    if (data.due_date) t.due_date = new Date(data.due_date);
    if (data.status) t.completed_at = data.status === 'done' ? new Date() : null;
    return this._saveTasks(employee, tasks.map((x, i) => (i === idx ? t : x)));
  }

  async removeTask(id, taskId, actor) {
    const employee = await this._load(id, actor);
    const tasks = employee.onboarding?.tasks || [];
    if (!tasks.some((t) => t.id === taskId)) throw ApiError.notFound('Onboarding task not found');
    return this._saveTasks(employee, tasks.filter((t) => t.id !== taskId));
  }

  // Adds the standard checklist's tasks that aren't already present (by title).
  async applyOnboardingTemplate(id, actor) {
    const employee = await this._load(id, actor);
    const tasks = employee.onboarding?.tasks || [];
    const have = new Set(tasks.map((t) => t.title.toLowerCase()));
    const fresh = this._tasksFromTemplate(employee.join_date).filter((t) => !have.has(t.title.toLowerCase()));
    return this._saveTasks(employee, [...tasks, ...fresh]);
  }

  // ---- skills & certifications ----
  async addSkill(id, data, actor) {
    const employee = await this._load(id, actor);
    const skills = employee.skills || [];
    const i = skills.findIndex((s) => s.name.toLowerCase() === data.name.toLowerCase());
    const next = i >= 0 ? skills.map((s, k) => (k === i ? { ...s, level: data.level ?? s.level } : s)) : [...skills, { name: data.name, level: data.level || null }];
    return hrEmployeeRepository.updateById(id, { skills: next });
  }

  async removeSkill(id, name, actor) {
    const employee = await this._load(id, actor);
    return hrEmployeeRepository.updateById(id, { skills: (employee.skills || []).filter((s) => s.name.toLowerCase() !== String(name).toLowerCase()) });
  }

  async addCertification(id, data, actor) {
    const employee = await this._load(id, actor);
    const cert = {
      id: randomUUID(), name: data.name, issuer: data.issuer || null,
      issued_on: data.issued_on ? new Date(data.issued_on) : null, expires_on: data.expires_on ? new Date(data.expires_on) : null,
      credential_id: data.credential_id || null, credential_url: data.credential_url || null,
    };
    return hrEmployeeRepository.updateById(id, { certifications: [...(employee.certifications || []), cert] });
  }

  async removeCertification(id, certId, actor) {
    const employee = await this._load(id, actor);
    const certs = employee.certifications || [];
    if (!certs.some((c) => c.id === certId)) throw ApiError.notFound('Certification not found');
    return hrEmployeeRepository.updateById(id, { certifications: certs.filter((c) => c.id !== certId) });
  }

  // ---- documents ----
  async addDocument(id, meta, file, actor) {
    if (!file) throw ApiError.badRequest('Attach a PDF, JPEG or PNG file in the "file" field');
    const employee = await this._load(id, actor);
    const url = await employeeDocStorage.save(file.buffer, { institutionId: employee.org_id, extension: file.extension, contentType: file.mimetype });
    const doc = {
      id: randomUUID(), name: meta.name || file.originalname, type: meta.type || 'other', url,
      size: file.size, content_type: file.mimetype, uploaded_at: new Date(), uploaded_by: actor.id, verified: false,
    };
    const updated = await hrEmployeeRepository.updateById(id, { documents: [...(employee.documents || []), doc] });
    return { employee: updated, document: doc };
  }

  async documentUrl(id, docId, actor) {
    const employee = await this._load(id, actor);
    const doc = (employee.documents || []).find((d) => d.id === docId);
    if (!doc) throw ApiError.notFound('Document not found');
    securityEvent(EVENTS.DOCUMENT_ACCESS_GRANTED, { document: 'employee_document', targetId: employee.id, documentId: docId });
    return { url: sign(doc.url) };
  }

  async verifyDocument(id, docId, verified, actor) {
    const employee = await this._load(id, actor);
    const docs = employee.documents || [];
    if (!docs.some((d) => d.id === docId)) throw ApiError.notFound('Document not found');
    return hrEmployeeRepository.updateById(id, {
      documents: docs.map((d) => (d.id === docId ? { ...d, verified: Boolean(verified), verified_by: actor.id, verified_at: new Date() } : d)),
    });
  }

  async removeDocument(id, docId, actor) {
    const employee = await this._load(id, actor);
    const doc = (employee.documents || []).find((d) => d.id === docId);
    if (!doc) throw ApiError.notFound('Document not found');
    await employeeDocStorage.remove(doc.url).catch(() => {});
    return hrEmployeeRepository.updateById(id, { documents: employee.documents.filter((d) => d.id !== docId) });
  }

  // ---- performance ----
  async addReview(id, data, actor) {
    const employee = await this._load(id, actor);
    const review = {
      id: randomUUID(), period: data.period, review_date: data.review_date ? new Date(data.review_date) : new Date(),
      reviewer_id: actor.id, reviewer_name: data.reviewer_name || null, rating: data.rating,
      goals: (data.goals || []).map((g) => ({ id: randomUUID(), title: g.title, status: g.status || 'pending', progress: g.progress ?? 0 })),
      kpis: data.kpis || [], strengths: data.strengths || null, improvements: data.improvements || null, comments: data.comments || null,
      created_at: new Date(),
    };
    return hrEmployeeRepository.updateById(id, { performance_reviews: [...(employee.performance_reviews || []), review] });
  }

  async removeReview(id, reviewId, actor) {
    const employee = await this._load(id, actor);
    const reviews = employee.performance_reviews || [];
    if (!reviews.some((r) => r.id === reviewId)) throw ApiError.notFound('Review not found');
    return hrEmployeeRepository.updateById(id, { performance_reviews: reviews.filter((r) => r.id !== reviewId) });
  }

  async updateGoal(id, reviewId, goalId, data, actor) {
    const employee = await this._load(id, actor);
    const reviews = employee.performance_reviews || [];
    const review = reviews.find((r) => r.id === reviewId);
    if (!review) throw ApiError.notFound('Review not found');
    if (!(review.goals || []).some((g) => g.id === goalId)) throw ApiError.notFound('Goal not found');
    const next = reviews.map((r) => (r.id !== reviewId ? r : { ...r, goals: r.goals.map((g) => (g.id === goalId ? { ...g, ...data } : g)) }));
    return hrEmployeeRepository.updateById(id, { performance_reviews: next });
  }

  async performanceSummary(id, actor) {
    const employee = await this._load(id, actor);
    const reviews = [...(employee.performance_reviews || [])].sort((a, b) => new Date(a.review_date) - new Date(b.review_date));
    const goals = reviews.flatMap((r) => r.goals || []);
    const avg = reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : null;
    const last = reviews[reviews.length - 1];
    const prev = reviews[reviews.length - 2];
    return {
      employee_id: employee.id,
      review_count: reviews.length,
      average_rating: avg,
      latest_rating: last ? last.rating : null,
      trend: last && prev ? (last.rating > prev.rating ? 'improving' : last.rating < prev.rating ? 'declining' : 'steady') : null,
      goals: { total: goals.length, completed: goals.filter((g) => g.status === 'done').length, in_progress: goals.filter((g) => g.status === 'in_progress').length },
      history: reviews.map((r) => ({ id: r.id, period: r.period, review_date: r.review_date, rating: r.rating })),
    };
  }

  // Headcount figures shared by the dashboard and the employee list header.
  async stats(actor) {
    const orgId = await getOrgId(actor);
    const match = orgId ? { org_id: orgId } : {};
    const rows = await hrEmployeeRepository.collection.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray();
    const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    const dept = await hrEmployeeRepository.collection
      .aggregate([{ $match: { ...match, status: { $ne: 'exited' } } }, { $group: { _id: '$department', count: { $sum: 1 } } }, { $sort: { count: -1 } }])
      .toArray();
    const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
    return {
      total_employees: total - (byStatus.exited || 0),
      by_status: byStatus,
      by_department: dept.filter((d) => d._id).map((d) => ({ department: d._id, count: d.count })),
      onboarding_in_progress: byStatus.onboarding || 0,
    };
  }
}

module.exports = new HrEmployeeService();
