const { randomUUID } = require('node:crypto');
const { getCollection } = require('../config/database');

// Generic CRUD repository shared by every entity module.
// `tableName` is always a hardcoded string from module code (never request input) and is used
// as the MongoDB collection name; `columns` is a fixed whitelist of field names — this is what
// keeps create()/update()/filter building here safe against mass-assignment: only whitelisted
// field *names* ever get written, and `_id` is always an app-generated UUID string (not Mongo's
// default ObjectId), which is what keeps existing JWT payloads / Joi `.uuid()` validations working
// unchanged across the rest of the codebase.
class BaseRepository {
  constructor(tableName, columns, { defaultOrderBy = { created_at: -1 }, defaults = {} } = {}) {
    this.tableName = tableName;
    this.columns = columns;
    this.defaultSort = defaultOrderBy;
    // Mirrors SQL `DEFAULT` clauses from the old Postgres schema (e.g. is_active DEFAULT TRUE) —
    // MongoDB has no column defaults, so a field simply missing from the insert becomes an
    // *absent* field, not the intended default value. Applied before caller-supplied fields so a
    // caller can still explicitly override any default.
    this.defaults = defaults;
  }

  get collection() {
    return getCollection(this.tableName);
  }

  _pickFields(data = {}) {
    const picked = {};
    for (const key of Object.keys(data)) {
      if (this.columns.includes(key) && data[key] !== undefined) picked[key] = data[key];
    }
    return picked;
  }

  _buildFilter(filters = {}) {
    const filter = {};
    for (const key of Object.keys(filters)) {
      const value = filters[key];
      if (value === undefined) continue;
      // Guards against Mongo operator injection: with Express's bracket-syntax query
      // parser, `?status[$ne]=x` arrives here as `{ status: { $ne: 'x' } }`. Column
      // names are already whitelisted above, but a whitelisted key still can't be
      // allowed to carry an object/array value straight into a query filter — reject
      // any query-string-provided value that isn't a primitive.
      if (value !== null && typeof value === 'object') continue;
      if (key === 'id') {
        filter._id = value;
      } else if (this.columns.includes(key)) {
        filter[key] = value;
      }
    }
    return filter;
  }

  _toEntity(doc) {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
  }

  async findAll({ page = 1, limit = 20, filters = {} } = {}) {
    const filter = this._buildFilter(filters);
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      this.collection.find(filter).sort(this.defaultSort).skip(skip).limit(limit).toArray(),
      this.collection.countDocuments(filter),
    ]);
    return { rows: docs.map((d) => this._toEntity(d)), total, page, limit };
  }

  async findById(id) {
    const doc = await this.collection.findOne({ _id: id });
    return this._toEntity(doc);
  }

  // Batches what would otherwise be N sequential findById calls (e.g.
  // resolving a list of foreign-key references) into a single $in query —
  // see student.service.js#dashboard for the call site this was added for.
  async findByIds(ids) {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (uniqueIds.length === 0) return [];
    const docs = await this.collection.find({ _id: { $in: uniqueIds } }).toArray();
    return docs.map((d) => this._toEntity(d));
  }

  async findOne(filters) {
    const filter = this._buildFilter(filters);
    if (Object.keys(filter).length === 0) return null; // never return an arbitrary unfiltered row
    const doc = await this.collection.findOne(filter);
    return this._toEntity(doc);
  }

  async create(data) {
    const now = new Date();
    const doc = { _id: randomUUID(), ...this.defaults, ...this._pickFields(data), created_at: now, updated_at: now };
    await this.collection.insertOne(doc);
    return this._toEntity(doc);
  }

  async updateById(id, data) {
    const picked = this._pickFields(data);
    if (Object.keys(picked).length === 0) return this.findById(id);
    picked.updated_at = new Date();

    const result = await this.collection.findOneAndUpdate(
      { _id: id },
      { $set: picked },
      { returnDocument: 'after' }
    );
    // Driver-version-proof: v5 wraps the doc as { value }, v6 returns the doc directly.
    const doc = result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result;
    return this._toEntity(doc);
  }

  async deleteById(id) {
    const { deletedCount } = await this.collection.deleteOne({ _id: id });
    return deletedCount > 0;
  }
}

module.exports = BaseRepository;
