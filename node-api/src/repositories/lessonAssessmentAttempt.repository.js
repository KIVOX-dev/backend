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

  // One row per lesson — whichever attempt is newest for that lesson — used
  // by course.service.js#getById to enrich the lesson list with per-lesson
  // assessment_status (available/completed/blocked) without an N+1 query
  // per lesson.
  async findLatestPerLessonForCourse(studentId, courseId) {
    const rows = await this.collection
      .aggregate([
        { $match: { student_id: studentId, course_id: courseId } },
        { $sort: { created_at: -1 } },
        { $group: { _id: '$lesson_id', doc: { $first: '$$ROOT' } } },
      ])
      .toArray();
    return rows.map((r) => this._toEntity(r.doc));
  }

  // Full history across every course — TestHistory.tsx's "Course
  // Assessments" section. Capped rather than paginated: a student's own
  // lesson-quiz history is realistically in the dozens/low hundreds, not
  // worth a paginated endpoint for now.
  findAllForStudent(studentId, limit = 200) {
    return this.collection
      .find({ student_id: studentId })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray()
      .then((docs) => docs.map((d) => this._toEntity(d)));
  }

  deleteByCourseId(courseId) {
    return this.collection.deleteMany({ course_id: courseId });
  }
}

module.exports = new LessonAssessmentAttemptRepository();
