const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/institution.model');

class InstitutionRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  // Unpaginated on purpose: this backs the public institution picker (see
  // institution.service.js#listPublic), same as python-service's GET /colleges.
  async findActiveSortedByName() {
    const docs = await this.collection.find({ is_active: true }).sort({ name: 1 }).toArray();
    return docs.map((d) => this._toEntity(d));
  }

  // Backs the kiosk/verification "identify student" lookup (see
  // student.service.js#identify) — a caller supplies a human-typed college
  // name, not an id, so this needs a case-insensitive partial match.
  async findByNameRegex(name) {
    const doc = await this.collection.findOne({ name: { $regex: name, $options: 'i' } });
    return this._toEntity(doc);
  }
}

module.exports = new InstitutionRepository();
