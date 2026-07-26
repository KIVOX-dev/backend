const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/notification.model');

class NotificationRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }
}

module.exports = new NotificationRepository();
