const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/placement.model');

class PlacementRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new PlacementRepository();
