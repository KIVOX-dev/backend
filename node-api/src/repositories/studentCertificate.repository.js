const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/studentCertificate.model');

class StudentCertificateRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  findForStudent(studentId) {
    return this.collection
      .find({ student_id: studentId })
      .sort(this.defaultSort)
      .toArray()
      .then((docs) => docs.map((d) => this._toEntity(d)));
  }
}

module.exports = new StudentCertificateRepository();
