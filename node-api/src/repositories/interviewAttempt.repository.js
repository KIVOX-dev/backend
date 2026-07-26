const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/interviewAttempt.model');

class InterviewAttemptRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  countForStudent(studentId) {
    return this.collection.countDocuments({ student_id: studentId });
  }
}

module.exports = new InterviewAttemptRepository();
