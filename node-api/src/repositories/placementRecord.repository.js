const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/placementRecord.model');
const { escapeRegex } = require('../utils/regex');

class PlacementRecordRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  countForStudent(studentId) {
    return this.collection.countDocuments({ student_id: studentId });
  }

  // Backs GET /search. Only searches company_name/role (fields that live on
  // this record itself) — matching by student name would need a join
  // against users, which the small set of admin search results this backs
  // doesn't need.
  async searchByCompanyOrRole(query, institutionId, limit = 10) {
    const safe = escapeRegex(query);
    const filter = { $or: [{ company_name: { $regex: safe, $options: 'i' } }, { role: { $regex: safe, $options: 'i' } }] };
    if (institutionId) filter.institution_id = institutionId;
    const docs = await this.collection.find(filter).limit(limit).toArray();
    return docs.map((d) => this._toEntity(d));
  }
}

module.exports = new PlacementRecordRepository();
