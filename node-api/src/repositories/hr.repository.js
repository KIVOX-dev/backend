const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/hr.model');

class HrRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  findByUserId(userId) {
    return this.findOne({ user_id: userId });
  }
}

module.exports = new HrRepository();
