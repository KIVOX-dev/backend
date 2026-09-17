const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/lesson.model');

class LessonRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaultOrderBy: { position: 1 } });
  }

  findByCourseId(courseId) {
    return this.collection.find({ course_id: courseId }).sort(this.defaultSort).toArray().then((docs) => docs.map((d) => this._toEntity(d)));
  }

  deleteByCourseId(courseId) {
    return this.collection.deleteMany({ course_id: courseId });
  }
}

module.exports = new LessonRepository();
