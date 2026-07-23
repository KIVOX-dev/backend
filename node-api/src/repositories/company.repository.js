const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/company.model');

class CompanyRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new CompanyRepository();
