const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/placementApplication.model');

class PlacementApplicationRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }
}

module.exports = new PlacementApplicationRepository();
