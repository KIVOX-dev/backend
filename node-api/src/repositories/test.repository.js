const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/test.model');

class TestRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  // A student sees the union of every open practice-bank test (category
  // set) plus any regular test explicitly assigned to them — see
  // test.service.js#list, which resolves assignedTestIds before calling this.
  async findVisibleToStudent(institutionId, assignedTestIds, { page, limit }) {
    const filter = {
      institution_id: institutionId,
      $or: [
        { category: { $ne: null } },
        { _id: { $in: assignedTestIds } },
      ],
    };
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      this.collection.find(filter).sort(this.defaultSort).skip(skip).limit(limit).toArray(),
      this.collection.countDocuments(filter),
    ]);
    return { rows: docs.map((d) => this._toEntity(d)), total };
  }
}

module.exports = new TestRepository();
