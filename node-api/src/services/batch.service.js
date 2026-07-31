const crypto = require('crypto');
const BaseService = require('./BaseService');
const batchRepository = require('../repositories/batch.repository');
const batchStudentRepository = require('../repositories/batchStudent.repository');
const userRepository = require('../repositories/user.repository');
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
      // No dedup check — matches python-service's create_batch exactly (see
      // batchStudent.model.js).
      await batchStudentRepository.create({ batch_id: batch.id, student_id: user.id });
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
