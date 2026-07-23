const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/student.model');

class StudentRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  findByUserId(userId) {
    return this.findOne({ user_id: userId });
  }
}

module.exports = new StudentRepository();
