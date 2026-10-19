const { randomUUID } = require('node:crypto');
const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/placementRound.model');

class PlacementRoundRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaultOrderBy: { round_number: 1 } });
  }

  findByPlacementAndNumber(placementId, roundNumber) {
    return this.findOne({ placement_id: placementId, round_number: roundNumber });
  }

  async listForPlacement(placementId) {
    const docs = await this.collection.find({ placement_id: placementId }).sort({ round_number: 1 }).toArray();
    return docs.map((d) => this._toEntity(d));
  }

  // Create-or-replace one round's details; the unique index keeps one row per number.
  async upsert(placementId, institutionId, roundNumber, fields) {
    const now = new Date();
    const set = { ...this._pickFields(fields), institution_id: institutionId, updated_at: now };
    delete set.placement_id;
    delete set.round_number;
    const doc = await this.collection.findOneAndUpdate(
      { placement_id: placementId, round_number: roundNumber },
      {
        $set: set,
        $setOnInsert: { _id: randomUUID(), placement_id: placementId, round_number: roundNumber, created_at: now },
      },
      { upsert: true, returnDocument: 'after' }
    );
    return this._toEntity(doc && Object.prototype.hasOwnProperty.call(doc, 'value') ? doc.value : doc);
  }
}

module.exports = new PlacementRoundRepository();
