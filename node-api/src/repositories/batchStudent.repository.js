const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/batchStudent.model');

class BatchStudentRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new BatchStudentRepository();
