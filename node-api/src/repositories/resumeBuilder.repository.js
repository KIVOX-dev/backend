const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/resumeBuilder.model');

class ResumeBuilderRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  findByStudentId(studentId) {
    return this.findOne({ student_id: studentId });
  }
}

module.exports = new ResumeBuilderRepository();
