const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/batch.model');

class BatchRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }
}

module.exports = new BatchRepository();
