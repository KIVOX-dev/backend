const BaseService = require('./BaseService');
const resumeBuilderRepository = require('../repositories/resumeBuilder.repository');
const studentRepository = require('../repositories/student.repository');
const ApiError = require('../utils/ApiError');

class ResumeBuilderService extends BaseService {
  constructor() {
    super(resumeBuilderRepository, { entityName: 'Resume' });
  }

  async getOwn(actor) {
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.badRequest('No student profile is linked to this account');
    const resume = await resumeBuilderRepository.findByStudentId(student.id);
    if (!resume) throw ApiError.notFound('Resume not created yet');
    return resume;
  }

  // Creates the resume on first save, updates it on every save after — the student
  // never supplies student_id directly, it is always resolved from their own account.
  async upsertOwn(actor, data) {
    const student = await studentRepository.findByUserId(actor.id);
    if (!student) throw ApiError.badRequest('No student profile is linked to this account');

    const existing = await resumeBuilderRepository.findByStudentId(student.id);
    if (existing) {
      return resumeBuilderRepository.updateById(existing.id, {
        template: data.template,
        data: data.data,
      });
    }
    return resumeBuilderRepository.create({
      student_id: student.id,
      template: data.template || 'default',
      data: data.data || {},
    });
  }
}

module.exports = new ResumeBuilderService();
