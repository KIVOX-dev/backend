const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/resumeVersion.model');

class ResumeVersionRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  async findByStudentId(studentId) {
    const docs = await this.collection.find({ student_id: studentId }).sort({ created_at: -1 }).toArray();
    return docs.map((d) => this._toEntity(d));
  }
}

module.exports = new ResumeVersionRepository();
