const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/lessonProgress.model');

class LessonProgressRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  findByCourseForStudent(studentId, courseId) {
    return this.collection
      .find({ student_id: studentId, course_id: courseId })
      .toArray()
      .then((docs) => docs.map((d) => this._toEntity(d)));
  }

  findOneForLesson(studentId, lessonId) {
    return this.findOne({ student_id: studentId, lesson_id: lessonId });
  }

  deleteByCourseId(courseId) {
    return this.collection.deleteMany({ course_id: courseId });
  }

  // Same shape/purpose as assessmentAttemptRepository/interviewAttemptRepository's
  // own #countByDay — see auth.service.js#activityHeatmap, which merges this
  // in as a third source. Grouped by completed_at (when the lesson was
  // finished), not created_at (when progress tracking on it started).
  async countByDay(studentId, since) {
    const rows = await this.collection
      .aggregate([
        { $match: { student_id: studentId, status: 'completed', completed_at: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$completed_at' } }, count: { $sum: 1 } } },
      ])
      .toArray();
    return rows.map((r) => ({ date: r._id, count: r.count }));
  }
}

module.exports = new LessonProgressRepository();
