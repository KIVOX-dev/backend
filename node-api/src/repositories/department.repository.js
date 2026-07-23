const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/department.model');

class DepartmentRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new DepartmentRepository();
