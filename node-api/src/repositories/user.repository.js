const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/user.model');
const { escapeRegex } = require('../utils/regex');

class UserRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  findByEmail(email) {
    return this.findOne({ email });
  }

  // Backs GET /search — institutionId null means unscoped (super_admin
  // only; every other caller must pass their own institutionId, matching
  // the scoping every other list endpoint in this app already enforces).
  async searchByNameOrEmail(query, institutionId, limit = 10) {
    const safe = escapeRegex(query);
    const filter = {
      $or: [{ full_name: { $regex: safe, $options: 'i' } }, { email: { $regex: safe, $options: 'i' } }],
    };
    if (institutionId) filter.institution_id = institutionId;
    const docs = await this.collection.find(filter).limit(limit).toArray();
    return docs.map((d) => this._toEntity(d));
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
