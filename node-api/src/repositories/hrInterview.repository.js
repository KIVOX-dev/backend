const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/hrInterview.model');

class HrInterviewRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }
}

module.exports = new HrInterviewRepository();
