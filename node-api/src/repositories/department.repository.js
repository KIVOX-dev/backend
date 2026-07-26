const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/department.model');

class DepartmentRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  async findByInstitutionId(institutionId) {
    const docs = await this.collection.find({ institution_id: institutionId }).sort({ name: 1 }).toArray();
    return docs.map((d) => this._toEntity(d));
  }
}

module.exports = new DepartmentRepository();
