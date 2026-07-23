const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/user.model');

class UserRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  findByEmail(email) {
    return this.findOne({ email });
  }

  findByGoogleId(googleId) {
    return this.findOne({ google_id: googleId });
  }
}

module.exports = new UserRepository();
