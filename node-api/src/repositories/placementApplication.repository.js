const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/placementApplication.model');

class PlacementApplicationRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  // { [placement_id]: count } for the given ids — backs the college-admin
  // "drives" dashboard (see placement.service.js#listDrives).
  async countByPlacementIds(placementIds) {
    if (placementIds.length === 0) return {};
    const rows = await this.collection
      .aggregate([
        { $match: { placement_id: { $in: placementIds } } },
        { $group: { _id: '$placement_id', count: { $sum: 1 } } },
      ])
      .toArray();
    return Object.fromEntries(rows.map((r) => [r._id, r.count]));
  }

  async findByPlacementIds(placementIds) {
    const docs = await this.collection.find({ placement_id: { $in: placementIds } }).toArray();
    return docs.map((d) => this._toEntity(d));
  }
}

module.exports = new PlacementApplicationRepository();
