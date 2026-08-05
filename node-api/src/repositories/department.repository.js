const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/department.model');

class DepartmentRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  async findByInstitutionId(institutionId) {
    if (!this._isPrimitive(institutionId)) return [];
    const docs = await this.collection.find({ institution_id: institutionId }).sort({ name: 1 }).toArray();
    return docs.map((d) => this._toEntity(d));
  }

  // Departments are always consumed as "every one for this institution" (a
  // dropdown/chip list), never as a browsable paginated table — an
  // arts_and_science college can have 150+ real departments (see
  // scripts/seedDepartments.js), so BaseRepository#findAll's default page
  // size would silently truncate. Used by department.service.js#list.
  async findAllUnpaginated(filters = {}) {
    const filter = this._buildFilter(filters);
    const docs = await this.collection.find(filter).sort({ name: 1 }).toArray();
    return docs.map((d) => this._toEntity(d));
  }
}

module.exports = new DepartmentRepository();
