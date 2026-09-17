const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/lessonNote.model');

class LessonNoteRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaultOrderBy: { timestamp_seconds: 1 } });
  }

  findByLessonForStudent(studentId, lessonId) {
    return this.collection
      .find({ student_id: studentId, lesson_id: lessonId })
      .sort(this.defaultSort)
      .toArray()
      .then((docs) => docs.map((d) => this._toEntity(d)));
  }

  deleteByCourseId(courseId) {
    return this.collection.deleteMany({ course_id: courseId });
  }
}

module.exports = new LessonNoteRepository();
