const studentRepository = require('../repositories/student.repository');
const userRepository = require('../repositories/user.repository');
const departmentRepository = require('../repositories/department.repository');
const placementRecordRepository = require('../repositories/placementRecord.repository');
const studentOutcomeRepository = require('../repositories/studentOutcome.repository');
const activityLogRepository = require('../repositories/activityLog.repository');
const notificationRepository = require('../repositories/notification.repository');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const recordActivity = require('../utils/recordActivity');
const { AUDIT_ACTIONS } = require('../utils/placementAudit');

// NIRF and NBA both look at the last three graduating batches.
const BATCHES = 3;
const REMINDER_TITLE = 'Offer letter needed';

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value * 100) / 100;
}

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

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

function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

// A document the caller can open through the normal signed-URL endpoints.
const evidenceOf = (kind, record) => (record.proof_url ? { kind, id: record.id } : null);

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

  outcomesFor(type, institutionId, studentIds) {
    return studentOutcomeRepository.findForStudents(type, studentIds, { institution_id: institutionId });
  }

  async availableYears(institutionId) {
    const values = await studentRepository.collection.distinct('batch_year', { institution_id: institutionId });
    return [...new Set(values.map((v) => Number(v)).filter((n) => Number.isInteger(n)))].sort((a, b) => b - a);
  }

  // Names/departments for a set of students, for the tables that list people.
  async peopleFor(institutionId, students) {
    const [users, departments] = await Promise.all([
      userRepository.findByIds(students.map((s) => s.user_id)),
      departmentRepository.findAllUnpaginated({ institution_id: institutionId }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const byStudentId = new Map(
      students.map((s) => [
        s.id,
        {
          name: userById.get(s.user_id)?.full_name || 'Unknown student',
          roll_number: s.roll_number || null,
          department: (s.department_id && deptName.get(s.department_id)) || 'Unassigned',
          batch_year: Number(s.batch_year) || null,
        },
      ])
    );
    return { byStudentId, deptName };
  }

  // What each report needs to know about who has reported what.
  async outcomeContext(institutionId, students) {
    const ids = students.map((s) => s.id);
    const [placements, higher] = await Promise.all([
      this.recordsFor(institutionId, ids),
      this.outcomesFor('higher_study', institutionId, ids),
    ]);
    const placementsByStudent = groupBy(placements, (r) => r.student_id);
    const higherByStudent = groupBy(higher, (o) => o.student_id);
    const pendingVerification =
      placements.filter((r) => r.verification_status === 'pending').length +
      higher.filter((o) => o.verification_status === 'pending').length;
    return { placements, higher, placementsByStudent, higherByStudent, pendingVerification };
  }

  // A student with neither a placement nor a higher-study record of any
  // status has no outcome on file — that's what the completeness warning counts.
  completeness(students, ctx) {
    const missing = students.filter((s) => !ctx.placementsByStudent.has(s.id) && !ctx.higherByStudent.has(s.id)).length;
    return { missing_outcome: missing, total_students: students.length, pending_verification: ctx.pendingVerification };
  }

  // Programme-wise placement table for the last three graduating batches.
  async nirf(actor, query) {
    const institutionId = institutionOf(actor, query);
    const availableYears = await this.availableYears(institutionId);
    const anchor = query.year || availableYears[0] || new Date().getFullYear();
    const years = Array.from({ length: BATCHES }, (_, i) => anchor - i);

    const [students, departments] = await Promise.all([
      this.studentsInScope(institutionId, { years, department_id: query.department_id }),
      departmentRepository.findAllUnpaginated({ institution_id: institutionId }),
    ]);
    const ctx = await this.outcomeContext(institutionId, students);
    const deptName = new Map(departments.map((d) => [d.id, d.name]));

    const groups = new Map();
    for (const s of students) {
      const year = Number(s.batch_year);
      const key = `${s.department_id || ''}|${year}`;
      if (!groups.has(key)) {
        groups.set(key, { department_id: s.department_id || null, batch_year: year, graduating: 0, placed: 0, higher: 0, salaries: [] });
      }
      const g = groups.get(key);
      g.graduating += 1;

      const verified = (ctx.placementsByStudent.get(s.id) || []).filter((r) => r.verification_status === 'verified');
      if (verified.length > 0) {
        g.placed += 1;
        // One salary per placed student (their best verified offer), so a
        // student with two offers doesn't pull the median twice.
        const best = Math.max(...verified.map((r) => Number(r.salary_lpa) || 0));
        if (best > 0) g.salaries.push(best);
      }
      if ((ctx.higherByStudent.get(s.id) || []).some((o) => o.verification_status === 'verified')) g.higher += 1;
    }

    const rows = [...groups.values()]
      .map((g) => ({
        department_id: g.department_id,
        department: (g.department_id && deptName.get(g.department_id)) || 'Unassigned',
        batch_year: g.batch_year,
        graduating: g.graduating,
        placed: g.placed,
        placement_pct: pct(g.placed, g.graduating),
        median_salary_lpa: median(g.salaries),
        higher_studies: g.higher,
      }))
      .sort((a, b) => b.batch_year - a.batch_year || a.department.localeCompare(b.department));

    return { available_years: availableYears, year: anchor, batches: years, rows, completeness: this.completeness(students, ctx) };
  }

  // NBA's placement-and-higher-studies table: per programme, for each of the
  // last three graduating batches, N students, x placed, y in higher studies
  // and the placement index (x + y) / N, averaged across the batches.
  // Entrepreneurship (z) isn't collected, so it is reported as not tracked.
  // A student who is both placed and in higher studies counts once, as placed.
  // N is the batch's graduating student count — intake numbers aren't stored.
  async nba(actor, query) {
    const institutionId = institutionOf(actor, query);
    const availableYears = await this.availableYears(institutionId);
    const anchor = query.year || availableYears[0] || new Date().getFullYear();
    const years = Array.from({ length: BATCHES }, (_, i) => anchor - i);

    const students = await this.studentsInScope(institutionId, { years, department_id: query.department_id });
    const [ctx, { deptName }] = await Promise.all([this.outcomeContext(institutionId, students), this.peopleFor(institutionId, [])]);

    const byDept = groupBy(students, (s) => s.department_id || '');
    const programmes = [...byDept.entries()]
      .map(([deptId, list]) => {
        const batches = years.map((batchYear) => {
          const inBatch = list.filter((s) => Number(s.batch_year) === batchYear);
          let placed = 0;
          let higher = 0;
          for (const s of inBatch) {
            const isPlaced = (ctx.placementsByStudent.get(s.id) || []).some((r) => r.verification_status === 'verified');
            const isHigher = (ctx.higherByStudent.get(s.id) || []).some((o) => o.verification_status === 'verified');
            if (isPlaced) placed += 1;
            else if (isHigher) higher += 1;
          }
          const n = inBatch.length;
          return { batch_year: batchYear, students: n, placed, higher_studies: higher, entrepreneurs: null, index: n ? Math.round(((placed + higher) / n) * 100) / 100 : null };
        });
        const scored = batches.filter((b) => b.index !== null);
        return {
          department_id: deptId || null,
          department: (deptId && deptName.get(deptId)) || 'Unassigned',
          batches,
          average_index: scored.length ? Math.round((scored.reduce((sum, b) => sum + b.index, 0) / scored.length) * 100) / 100 : null,
        };
      })
      .sort((a, b) => a.department.localeCompare(b.department));

    return { available_years: availableYears, year: anchor, batches: years, programmes, completeness: this.completeness(students, ctx) };
  }

  // Student list with the course and institution they progressed to.
  async higherStudies(actor, query) {
    const institutionId = institutionOf(actor, query);
    const students = await this.studentsInScope(institutionId, { years: query.year ? [query.year] : null, department_id: query.department_id });
    const [ctx, { byStudentId }] = await Promise.all([this.outcomeContext(institutionId, students), this.peopleFor(institutionId, students)]);

    const counts = { pending: 0, verified: 0, rejected: 0 };
    const rows = ctx.higher.map((o) => {
      counts[o.verification_status] += 1;
      const p = byStudentId.get(o.student_id);
      return {
        id: o.id,
        student: p?.name,
        roll_number: p?.roll_number,
        department: p?.department,
        batch_year: p?.batch_year,
        course: o.course,
        institution_name: o.institution_name,
        admission_year: o.admission_year ?? null,
        status: o.verification_status,
        has_proof: Boolean(o.proof_url),
      };
    });
    return {
      available_years: await this.availableYears(institutionId),
      counts: { ...counts, total: rows.length },
      rows,
      completeness: this.completeness(students, ctx),
    };
  }

  // GATE / NET / CAT / GRE ... results with their score cards.
  async competitiveExams(actor, query) {
    const institutionId = institutionOf(actor, query);
    const students = await this.studentsInScope(institutionId, { years: query.year ? [query.year] : null, department_id: query.department_id });
    const [ctx, exams, { byStudentId }] = await Promise.all([
      this.outcomeContext(institutionId, students),
      this.outcomesFor('competitive_exam', institutionId, students.map((s) => s.id)),
      this.peopleFor(institutionId, students),
    ]);

    const counts = { pending: 0, verified: 0, rejected: 0 };
    const byExam = {};
    const rows = exams.map((o) => {
      counts[o.verification_status] += 1;
      byExam[o.exam] = byExam[o.exam] || { total: 0, qualified: 0 };
      byExam[o.exam].total += 1;
      if (o.qualified) byExam[o.exam].qualified += 1;
      const p = byStudentId.get(o.student_id);
      return {
        id: o.id,
        student: p?.name,
        roll_number: p?.roll_number,
        department: p?.department,
        batch_year: p?.batch_year,
        exam: o.exam,
        exam_year: o.exam_year,
        score: o.score ?? null,
        rank_or_percentile: o.rank_or_percentile ?? null,
        qualified: Boolean(o.qualified),
        status: o.verification_status,
        has_proof: Boolean(o.proof_url),
      };
    });
    return {
      available_years: await this.availableYears(institutionId),
      counts: { ...counts, total: rows.length },
      by_exam: byExam,
      rows,
      completeness: {
        ...this.completeness(students, ctx),
        pending_verification: counts.pending,
      },
    };
  }

  // NAAC Criterion 5.2 — student progression. Only verified entries count;
  // each row carries an evidence reference the screen turns into a link.
  //   5.2.1 placement of outgoing students
  //   5.2.2 progression to higher education
  //   5.2.3 qualifying in competitive examinations
  async naac(actor, query) {
    const institutionId = institutionOf(actor, query);
    const students = await this.studentsInScope(institutionId, { years: query.year ? [query.year] : null, department_id: query.department_id });
    const ids = students.map((s) => s.id);
    const [ctx, exams, { byStudentId }] = await Promise.all([
      this.outcomeContext(institutionId, students),
      this.outcomesFor('competitive_exam', institutionId, ids),
      this.peopleFor(institutionId, students),
    ]);

    const verified = (list, statusOf) => list.filter((x) => statusOf(x) === 'verified');
    const placements = verified(ctx.placements, (r) => r.verification_status);
    const higher = verified(ctx.higher, (o) => o.verification_status);
    const qualified = verified(exams, (o) => o.verification_status).filter((o) => o.qualified);

    const outgoingByYear = new Map();
    for (const s of students) {
      const y = Number(s.batch_year);
      outgoingByYear.set(y, (outgoingByYear.get(y) || 0) + 1);
    }
    const summarise = (records) => {
      const studentsByYear = new Map();
      for (const r of records) {
        const y = byStudentId.get(r.student_id)?.batch_year;
        if (!y) continue;
        if (!studentsByYear.has(y)) studentsByYear.set(y, new Set());
        studentsByYear.get(y).add(r.student_id);
      }
      return [...outgoingByYear.keys()]
        .sort((a, b) => b - a)
        .map((year) => {
          const count = studentsByYear.get(year)?.size || 0;
          return { year, outgoing: outgoingByYear.get(year), count, pct: pct(count, outgoingByYear.get(year)) };
        });
    };
    const base = (r) => {
      const p = byStudentId.get(r.student_id);
      return { year: p?.batch_year ?? null, student: p?.name, roll_number: p?.roll_number, programme: p?.department };
    };
    const byYearDesc = (a, b) => (b.year || 0) - (a.year || 0);

    return {
      available_years: await this.availableYears(institutionId),
      c521: {
        summary: summarise(placements),
        rows: placements
          .map((r) => ({ ...base(r), employer: r.company_name, package_lpa: r.salary_lpa ?? null, evidence: evidenceOf('placement', r) }))
          .sort(byYearDesc),
      },
      c522: {
        summary: summarise(higher),
        rows: higher
          .map((o) => ({ ...base(o), institution_joined: o.institution_name, programme_admitted: o.course, evidence: evidenceOf('outcome', o) }))
          .sort(byYearDesc),
      },
      c523: {
        summary: summarise(qualified),
        rows: qualified
          .map((o) => ({ ...base(o), exam: o.exam, exam_year: o.exam_year, evidence: evidenceOf('outcome', o) }))
          .sort(byYearDesc),
      },
      completeness: {
        ...this.completeness(students, ctx),
        pending_verification: ctx.pendingVerification + exams.filter((o) => o.verification_status === 'pending').length,
      },
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
    const [ctx, { byStudentId }] = await Promise.all([this.outcomeContext(institutionId, students), this.peopleFor(institutionId, students)]);

    const counts = { pending: 0, uploaded: 0, verified: 0, rejected: 0 };
    const rows = ctx.placements.map((r) => {
      const status = this.letterStatus(r);
      counts[status] += 1;
      const p = byStudentId.get(r.student_id);
      return {
        id: r.id,
        student: p?.name || 'Unknown student',
        roll_number: p?.roll_number || null,
        department: p?.department || 'Unassigned',
        batch_year: p?.batch_year || null,
        company: r.company_name,
        role: r.role,
        status,
        has_letter: Boolean(r.proof_url),
      };
    });

    return {
      available_years: await this.availableYears(institutionId),
      counts: { ...counts, total: rows.length },
      rows,
      completeness: this.completeness(students, ctx),
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
        message: `Your placement at ${company} has no offer letter on file. Open Placements and upload it from your placement row.`,
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

  // Students an admin can pick when entering an outcome on someone's behalf.
  // Searches name and roll number; capped so a big institution doesn't ship
  // its whole roll to the browser.
  async studentOptions(actor, query) {
    const institutionId = institutionOf(actor, query);
    const students = await this.studentsInScope(institutionId, { years: query.year ? [query.year] : null, department_id: query.department_id });
    const { byStudentId } = await this.peopleFor(institutionId, students);
    const needle = (query.q || '').trim().toLowerCase();
    return students
      .map((s) => ({ id: s.id, ...byStudentId.get(s.id) }))
      .filter((s) => !needle || s.name.toLowerCase().includes(needle) || (s.roll_number || '').toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50);
  }

  // Every placement and outcome add, verification and delete, newest first.
  // Entries are written with their institution/batch/department in metadata
  // (see utils/placementAudit.js), which is what makes them filterable here.
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
          subject: m.company_name || m.subject || null,
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
