const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/mockSession.model');

class MockSessionRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  async listForStudent(studentId, limit = 100) {
    const docs = await this.collection.find({ student_id: studentId }).sort({ started_at: -1 }).limit(limit).toArray();
    return docs.map((d) => this._toEntity(d));
  }

  // Marks abandoned in-progress sessions as incomplete (lazy sweep, run on reads).
  async markStaleIncomplete(studentId, olderThan) {
    return this.collection.updateMany(
      { student_id: studentId, status: 'in_progress', last_activity_at: { $lt: olderThan } },
      { $set: { status: 'incomplete', updated_at: new Date() } }
    );
  }
}

module.exports = new MockSessionRepository();
