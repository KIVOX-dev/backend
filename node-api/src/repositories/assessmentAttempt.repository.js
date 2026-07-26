const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/assessmentAttempt.model');

class AssessmentAttemptRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  countForStudentAndTest(studentId, testId) {
    return this.collection.countDocuments({ student_id: studentId, test_id: testId });
  }

  countCompletedForStudent(studentId) {
    return this.collection.countDocuments({ student_id: studentId, status: 'completed' });
  }

  // Backs dashboard.py's aggregation-based student dashboard — computed
  // fresh from attempts rather than read off the students collection's
  // cached tests_completed/avg_accuracy (which students.py's own dashboard
  // endpoint uses instead; both exist in python-service, ported as separate
  // endpoints here too — see dashboard.service.js).
  async aggregateStatsForStudent(studentId) {
    const [result] = await this.collection
      .aggregate([
        { $match: { student_id: studentId, status: 'completed' } },
        { $group: { _id: null, tests_completed: { $sum: 1 }, avg_accuracy: { $avg: { $ifNull: ['$percentage', 0] } } } },
      ])
      .toArray();
    return result ? { tests_completed: result.tests_completed, avg_accuracy: result.avg_accuracy } : { tests_completed: 0, avg_accuracy: 0 };
  }

  async recentForStudent(studentId, limit = 100) {
    const docs = await this.collection
      .find({ student_id: studentId })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => this._toEntity(d)).reverse(); // oldest-first, matching python's in-app reverse
  }
}

module.exports = new AssessmentAttemptRepository();
