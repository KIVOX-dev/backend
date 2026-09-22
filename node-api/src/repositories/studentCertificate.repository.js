const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/studentCertificate.model');

class StudentCertificateRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  findForStudent(studentId) {
    return this.collection
      .find({ student_id: studentId })
      .sort(this.defaultSort)
      .toArray()
      .then((docs) => docs.map((d) => this._toEntity(d)));
  }

  findRoleCertificate(studentId, roleId) {
    return this.findOne({ student_id: studentId, type: 'role', role_id: roleId });
  }
}

module.exports = new StudentCertificateRepository();
