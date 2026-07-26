const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/user.model');

class UserRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  findByEmail(email) {
    return this.findOne({ email });
  }

  findByGoogleId(googleId) {
    return this.findOne({ google_id: googleId });
  }

  findByResetTokenHash(tokenHash) {
    return this.findOne({ reset_password_token_hash: tokenHash });
  }

  findByVerificationTokenHash(tokenHash) {
    return this.findOne({ email_verification_token_hash: tokenHash });
  }
}

module.exports = new UserRepository();
