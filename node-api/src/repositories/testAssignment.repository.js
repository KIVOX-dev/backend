const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/testAssignment.model');

class TestAssignmentRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }
}

module.exports = new TestAssignmentRepository();
