const crypto = require('crypto');
const BaseService = require('./BaseService');
const batchRepository = require('../repositories/batch.repository');
const batchStudentRepository = require('../repositories/batchStudent.repository');
const userRepository = require('../repositories/user.repository');
const studentRepository = require('../repositories/student.repository');
const { findOrCreateStudentUser } = require('../utils/studentOnboarding');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');

class BatchService extends BaseService {
  constructor() {
    super(batchRepository, { entityName: 'Batch' });
  }

  async create({ name, batchCode, department, year, students = [] }, actor) {
    const batch = await batchRepository.create({
      name,
      batch_code: batchCode || `BAT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      institution_id: actor.institutionId,
      faculty_id: actor.id,
      department,
      year,
    });

    const createdStudents = [];
    for (const item of students) {
      const { user, created, tempPassword } = await findOrCreateStudentUser({
        item,
        institutionId: batch.institution_id,
        department: batch.department,
        year: batch.year,
        status: 'approved',
      });
      // student_id here must be the `students` collection's own row id —
      // the same convention test_assignments/results/achievements/
      // placement_applications/resume_builder all use — not user.id (the
      // `users` collection's id). findOrCreateStudentUser always creates the
      // paired students row alongside a brand-new user (see
      // studentOnboarding.js), and every existing student-role user already
      // has one from whenever they were first onboarded, so this lookup
      // should always resolve; skip (rather than crash the whole batch
      // import) on the one row if it somehow doesn't. See
      // PROJECT_AUDIT_REPORT.md P1-6 — this used to store user.id, silently
      // breaking any future feature that joins batch_students to students
      // by student_id.
      const student = await studentRepository.findByUserId(user.id);
      if (student) {
        // No dedup check — matches python-service's create_batch exactly (see
        // batchStudent.model.js).
        await batchStudentRepository.create({ batch_id: batch.id, student_id: student.id });
      }
      if (created && tempPassword) {
        createdStudents.push({ id: user.id, email: user.email, name: user.full_name, tempPassword });
      }
    }

    return { ...batch, createdStudents };
  }

  async history(actor) {
    const filters = actor.role === ROLES.SUPER_ADMIN ? {} : { institution_id: actor.institutionId };
    const { rows } = await super.list({ limit: 1000 }, filters);
    return rows;
  }

  // "pending" here means active batches, matching python-service's naming
  // exactly (batches.py#pending_batches filters status="active", not
  // "pending" — kept as-is rather than silently renaming to avoid papering
  // over what the endpoint's existing consumers actually expect).
  async pending(actor) {
    const filters = actor.role === ROLES.SUPER_ADMIN ? { status: 'active' } : { status: 'active', institution_id: actor.institutionId };
    const { rows } = await super.list({ limit: 1000 }, filters);
    return rows;
  }

  async listStudents(actor) {
    const filters = { role: ROLES.STUDENT };
    if (actor.role !== ROLES.SUPER_ADMIN) filters.institution_id = actor.institutionId;
    const { rows } = await userRepository.findAll({ page: 1, limit: 1000, filters });
    return rows.map((u) => ({ id: u.id, name: u.full_name, email: u.email, department: u.department }));
  }

  async updateStatus(batchId, status, actor) {
    const batch = await batchRepository.findById(batchId);
    if (!batch) throw ApiError.notFound('Batch not found');
    if (actor.role !== ROLES.SUPER_ADMIN && batch.institution_id !== actor.institutionId) {
      throw ApiError.forbidden('You do not have access to this resource');
    }
    await batchRepository.updateById(batchId, { status });
  }
}

module.exports = new BatchService();
