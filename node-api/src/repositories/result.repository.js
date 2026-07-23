const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/result.model');

class ResultRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new ResultRepository();
