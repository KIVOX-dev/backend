const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/test.model');

class TestRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new TestRepository();
