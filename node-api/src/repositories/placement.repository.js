const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/placement.model');

class PlacementRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }
}

module.exports = new PlacementRepository();
