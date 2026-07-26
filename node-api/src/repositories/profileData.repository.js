const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/profileData.model');

class ProfileDataRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  findByUserId(userId) {
    return this.findOne({ user_id: userId });
  }
}

module.exports = new ProfileDataRepository();
