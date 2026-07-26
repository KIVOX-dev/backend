const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/userData.model');

class UserDataRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  findByUserId(userId) {
    return this.findOne({ user_id: userId });
  }
}

module.exports = new UserDataRepository();
