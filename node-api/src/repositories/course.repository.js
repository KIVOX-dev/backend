const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/course.model');

class CourseRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  findForStudent(studentId) {
    return this.collection.find({ student_id: studentId }).sort(this.defaultSort).toArray().then((docs) => docs.map((d) => this._toEntity(d)));
  }
}

module.exports = new CourseRepository();
