const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/hrEvaluation.model');

class HrEvaluationRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }
}

module.exports = new HrEvaluationRepository();
