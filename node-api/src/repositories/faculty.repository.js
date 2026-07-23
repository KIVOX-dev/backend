const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/faculty.model');

class FacultyRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new FacultyRepository();
