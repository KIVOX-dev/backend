const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/interviewResponse.model');

class InterviewResponseRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new InterviewResponseRepository();
