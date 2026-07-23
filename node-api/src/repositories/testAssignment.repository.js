const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/testAssignment.model');

class TestAssignmentRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new TestAssignmentRepository();
