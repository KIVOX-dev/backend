const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/hrEmployee.model');

class HrEmployeeRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }
}

module.exports = new HrEmployeeRepository();
