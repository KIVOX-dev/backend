const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/activityLog.model');

class ActivityLogRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new ActivityLogRepository();
