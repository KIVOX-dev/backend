const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/collegeAdmin.model');

class CollegeAdminRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new CollegeAdminRepository();
