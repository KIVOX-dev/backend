const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/notification.model');

class NotificationRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new NotificationRepository();
