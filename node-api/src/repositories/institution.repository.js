const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/institution.model');

class InstitutionRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new InstitutionRepository();
