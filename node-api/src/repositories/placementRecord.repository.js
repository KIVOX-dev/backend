const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/placementRecord.model');

class PlacementRecordRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  countForStudent(studentId) {
    return this.collection.countDocuments({ student_id: studentId });
  }
}

module.exports = new PlacementRecordRepository();
