const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/interviewAttempt.model');

class InterviewAttemptRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  countForStudent(studentId) {
    return this.collection.countDocuments({ student_id: studentId });
  }

  // Same day-grouping purpose as assessmentAttemptRepository#countByDay —
  // see auth.service.js#activityHeatmap, which merges this with the other
  // sources.
  async countByDay(studentId, since) {
    const rows = await this.collection
      .aggregate([
        { $match: { student_id: studentId, created_at: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, count: { $sum: 1 } } },
      ])
      .toArray();
    return rows.map((r) => ({ date: r._id, count: r.count }));
  }
}

module.exports = new InterviewAttemptRepository();
