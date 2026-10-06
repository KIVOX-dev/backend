const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/hrTalentPool.model');

class HrTalentPoolRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }
}

module.exports = new HrTalentPoolRepository();
