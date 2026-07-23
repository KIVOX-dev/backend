const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/hr.model');

class HrRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new HrRepository();
