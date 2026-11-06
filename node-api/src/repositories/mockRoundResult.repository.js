const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/mockRoundResult.model');

class MockRoundResultRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaultOrderBy: { round: 1 } });
  }

  async listForSession(sessionId) {
    const docs = await this.collection.find({ session_id: sessionId }).sort({ round: 1 }).toArray();
    return docs.map((d) => this._toEntity(d));
  }

  async findBySessionAndRound(sessionId, round) {
    return this._toEntity(await this.collection.findOne({ session_id: sessionId, round }));
  }
}

module.exports = new MockRoundResultRepository();
