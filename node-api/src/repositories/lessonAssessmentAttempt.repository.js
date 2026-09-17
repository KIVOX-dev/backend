const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/lessonAssessmentAttempt.model');

class LessonAssessmentAttemptRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  findLatestForLesson(studentId, lessonId) {
    return this.collection
      .find({ student_id: studentId, lesson_id: lessonId })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray()
      .then((docs) => this._toEntity(docs[0]));
  }

  deleteByCourseId(courseId) {
    return this.collection.deleteMany({ course_id: courseId });
  }
}

module.exports = new LessonAssessmentAttemptRepository();
