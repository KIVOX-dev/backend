const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/test.model');

class TestRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }
}

module.exports = new TestRepository();
