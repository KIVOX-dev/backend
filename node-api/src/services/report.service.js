const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const departmentRepository = require('../repositories/department.repository');
const placementRecordRepository = require('../repositories/placementRecord.repository');
const activityLogRepository = require('../repositories/activityLog.repository');
const notificationRepository = require('../repositories/notification.repository');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const recordActivity = require('../utils/recordActivity');
const { AUDIT_ACTIONS } = require('../utils/placementAudit');

// NIRF asks for the last three graduating batches.
const NIRF_BATCHES = 3;
const REMINDER_TITLE = 'Offer letter needed';

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value * 100) / 100;
}

// students.batch_year isn't consistently typed across the upload/import
// flows (a number in some, a string in others), so every batch filter
// matches both spellings.
function batchYearValues(years) {
  return years.flatMap((y) => [y, String(y)]);
}

// Which institution a report covers. Institution admins are pinned to their
// own; a super_admin has none of their own and must name one.
function institutionOf(actor, query) {
  if (actor.role === ROLES.SUPER_ADMIN) {
    if (!query.institution_id) throw ApiError.badRequest('institution_id is required');
    return query.institution_id;
  }
  if (!actor.institutionId) throw ApiError.forbidden('Your account is not linked to an institution');
  return actor.institutionId;
}

class ReportService {
  async studentsInScope(institutionId, { years, department_id: departmentId }) {
    const filter = { institution_id: institutionId };
    if (years && years.length) filter.batch_year = { $in: batchYearValues(years) };
    if (departmentId) filter.department_id = departmentId;
    const docs = await studentRepository.collection
      .find(filter, { projection: { user_id: 1, department_id: 1, batch_year: 1, roll_number: 1 } })
      .toArray();
    return docs.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
  }

  async recordsFor(institutionId, studentIds, extra = {}) {
    if (studentIds.length === 0) return [];
    const docs = await placementRecordRepository.collection
      .find({ institution_id: institutionId, student_id: { $in: studentIds }, ...extra })
      .toArray();
    return docs.map((d) => placementRecordRepository._toEntity(d));
  }

  async availableYears(institutionId) {
    const values = await studentRepository.collection.distinct('batch_year', { institution_id: institutionId });
    return [...new Set(values.map((v) => Number(v)).filter((n) => Number.isInteger(n)))].sort((a, b) => b - a);
  }

  // Programme-wise placement table for the last three graduating batches.
  // Higher-studies outcomes aren't stored anywhere yet, so that column is
  // reported as null (shown as "Not tracked") rather than a misleading 0.
  async nirf(actor, query) {
    const institutionId = institutionOf(actor, query);
    const availableYears = await this.availableYears(institutionId);
    const anchor = query.year || availableYears[0] || new Date().getFullYear();
    const years = Array.from({ length: NIRF_BATCHES }, (_, i) => anchor - i);

    const [students, departments] = await Promise.all([
      this.studentsInScope(institutionId, { years, department_id: query.department_id }),
      departmentRepository.findAllUnpaginated({ institution_id: institutionId }),
    ]);
    const records = await this.recordsFor(institutionId, students.map((s) => s.id));

    const recordsByStudent = new Map();
    for (const r of records) {
      if (!recordsByStudent.has(r.student_id)) recordsByStudent.set(r.student_id, []);
      recordsByStudent.get(r.student_id).push(r);
    }
    const deptName = new Map(departments.map((d) => [d.id, d.name]));

    const groups = new Map();
    let missingOutcome = 0;
    for (const s of students) {
      const year = Number(s.batch_year);
      const key = `${s.department_id || ''}|${year}`;
      if (!groups.has(key)) {
        groups.set(key, { department_id: s.department_id || null, batch_year: year, graduating: 0, placed: 0, salaries: [] });
      }
      const g = groups.get(key);
      g.graduating += 1;

      const mine = recordsByStudent.get(s.id) || [];
      if (mine.length === 0) missingOutcome += 1;
      const verified = mine.filter((r) => r.verification_status === 'verified');
      if (verified.length > 0) {
        g.placed += 1;
        // One salary per placed student (their best verified offer), so a
        // student with two offers doesn't pull the median twice.
        const best = Math.max(...verified.map((r) => Number(r.salary_lpa) || 0));
        if (best > 0) g.salaries.push(best);
      }
    }

    const rows = [...groups.values()]
      .map((g) => ({
        department_id: g.department_id,
        department: (g.department_id && deptName.get(g.department_id)) || 'Unassigned',
        batch_year: g.batch_year,
        graduating: g.graduating,
        placed: g.placed,
        placement_pct: g.graduating ? Math.round((g.placed / g.graduating) * 1000) / 10 : 0,
        median_salary_lpa: median(g.salaries),
        higher_studies: null,
      }))
      .sort((a, b) => b.batch_year - a.batch_year || a.department.localeCompare(b.department));

    return {
      available_years: availableYears,
      year: anchor,
      batches: years,
      rows,
      completeness: { missing_outcome: missingOutcome, total_students: students.length },
    };
  }

  // pending  = placement on record, no offer letter yet
  // uploaded = letter on file, awaiting verification
  // verified / rejected = the admin's decision
  letterStatus(record) {
    if (record.verification_status === 'rejected') return 'rejected';
    if (!record.proof_url) return 'pending';
    return record.verification_status === 'verified' ? 'verified' : 'uploaded';
  }

  async offerLetters(actor, query) {
    const institutionId = institutionOf(actor, query);
    const students = await this.studentsInScope(institutionId, {
      years: query.year ? [query.year] : null,
      department_id: query.department_id,
    });
    const records = await this.recordsFor(institutionId, students.map((s) => s.id));

    const [users, departments] = await Promise.all([
      userRepository.findByIds(students.map((s) => s.user_id)),
      departmentRepository.findAllUnpaginated({ institution_id: institutionId }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const studentById = new Map(students.map((s) => [s.id, s]));

    const counts = { pending: 0, uploaded: 0, verified: 0, rejected: 0 };
    const rows = records.map((r) => {
      const status = this.letterStatus(r);
      counts[status] += 1;
      const s = studentById.get(r.student_id);
      const u = s && userById.get(s.user_id);
      return {
        id: r.id,
        student: u?.full_name || 'Unknown student',
        roll_number: s?.roll_number || null,
        department: (s?.department_id && deptName.get(s.department_id)) || 'Unassigned',
        batch_year: s ? Number(s.batch_year) : null,
        company: r.company_name,
        role: r.role,
        status,
      };
    });

    const withRecord = new Set(records.map((r) => r.student_id));
    return {
      available_years: await this.availableYears(institutionId),
      counts: { ...counts, total: records.length },
      rows,
      completeness: {
        missing_outcome: students.filter((s) => !withRecord.has(s.id)).length,
        total_students: students.length,
      },
    };
  }

  // Nudges every student in scope whose placement still has no offer letter.
  // A student with an unread reminder already waiting is skipped, so pressing
  // the button twice doesn't spam anyone.
  async remindOfferLetters(actor, query) {
    const institutionId = institutionOf(actor, query);
    const students = await this.studentsInScope(institutionId, {
      years: query.year ? [query.year] : null,
      department_id: query.department_id,
    });
    const records = await this.recordsFor(institutionId, students.map((s) => s.id));
    const studentById = new Map(students.map((s) => [s.id, s]));

    const pending = new Map(); // user_id -> company of their first pending placement
    for (const r of records) {
      if (this.letterStatus(r) !== 'pending') continue;
      const s = studentById.get(r.student_id);
      if (s && !pending.has(s.user_id)) pending.set(s.user_id, r.company_name);
    }

    let sent = 0;
    let skipped = 0;
    for (const [userId, company] of pending) {
      const alreadyWaiting = await notificationRepository.findOne({ user_id: userId, title: REMINDER_TITLE, is_read: false });
      if (alreadyWaiting) {
        skipped += 1;
        continue;
      }
      await notificationRepository.create({
        user_id: userId,
        title: REMINDER_TITLE,
        message: `Your placement at ${company} has no offer letter on file. Please share it with your placement office.`,
        type: 'warning',
      });
      sent += 1;
    }

    await recordActivity({
      userId: actor.id,
      action: 'offer_letter_reminder',
      entityType: 'placement_record',
      metadata: { institution_id: institutionId, sent, skipped, batch_year: query.year ?? null, department_id: query.department_id ?? null },
    });
    return { sent, skipped, total: pending.size };
  }

  // Every placement add, verification and delete, newest first. Entries are
  // written with their institution/batch/department in metadata (see
  // utils/placementAudit.js), which is what makes them filterable here.
  async auditLog(actor, query) {
    const institutionId = institutionOf(actor, query);
    const filter = { action: { $in: AUDIT_ACTIONS }, 'metadata.institution_id': institutionId };
    if (query.year) filter['metadata.batch_year'] = { $in: batchYearValues([query.year]) };
    if (query.department_id) filter['metadata.department_id'] = query.department_id;

    const skip = (query.page - 1) * query.limit;
    const [docs, total] = await Promise.all([
      activityLogRepository.collection.find(filter).sort({ created_at: -1 }).skip(skip).limit(query.limit).toArray(),
      activityLogRepository.collection.countDocuments(filter),
    ]);

    const actors = await userRepository.findByIds(docs.map((d) => d.user_id));
    const actorById = new Map(actors.map((u) => [u.id, u]));

    return {
      rows: docs.map((d) => {
        const a = actorById.get(d.user_id);
        const m = d.metadata || {};
        return {
          id: d._id,
          at: d.created_at,
          action: d.action,
          actor: a?.full_name || 'Unknown user',
          actor_role: a?.role || null,
          student: m.student_name || null,
          company: m.company_name || null,
          detail: m.verification_status || null,
        };
      }),
      total,
      page: query.page,
      limit: query.limit,
      available_years: await this.availableYears(institutionId),
    };
  }
}

module.exports = new ReportService();
