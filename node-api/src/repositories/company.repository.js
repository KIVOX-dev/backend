const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/company.model');

class CompanyRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }
}

module.exports = new CompanyRepository();
