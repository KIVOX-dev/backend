const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/studentOutcome.model');

class StudentOutcomeRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  // Every outcome of one type for a set of students — what the reports
  // aggregate over. `studentIds` comes from a prior institution-scoped
  // student query, never from request input.
  async findForStudents(type, studentIds, extra = {}) {
    if (!Array.isArray(studentIds) || studentIds.length === 0) return [];
    const docs = await this.collection.find({ type, student_id: { $in: studentIds }, ...extra }).toArray();
    return docs.map((d) => this._toEntity(d));
  }
}

module.exports = new StudentOutcomeRepository();
