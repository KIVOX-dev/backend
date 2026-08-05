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

  // Guards against Mongo operator injection: with Express's bracket-syntax query
  // parser, `?status[$ne]=x` arrives as `{ status: { $ne: 'x' } }`, and a JSON
  // body can carry `{ "id": { "$ne": null } }` just as easily. A value that's
  // an object (or array) here is either a caller bug or an attacker trying to
  // smuggle a query operator in where a literal value belongs — never safe to
  // interpolate into a filter.
  _isPrimitive(value) {
    return value === null || typeof value !== 'object';
  }

  _buildFilter(filters = {}) {
    const filter = {};
    for (const key of Object.keys(filters)) {
      const value = filters[key];
      if (value === undefined) continue;
      if (!this._isPrimitive(value)) continue;
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

  async findAll({ page = 1, limit = 20, filters = {}, sort } = {}) {
    const filter = this._buildFilter(filters);
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      this.collection
        .find(filter)
        .sort(sort || this.defaultSort)
        .skip(skip)
        .limit(limit)
        .toArray(),
      this.collection.countDocuments(filter),
    ]);
    return { rows: docs.map((d) => this._toEntity(d)), total, page, limit };
  }

  // Whitelist-only: `field` must be a real column (or `id`/`created_at`,
  // always present) — never pass a caller-supplied key straight into a
  // MongoDB sort spec (same reasoning as _buildFilter's operator-injection
  // guard above). Returns undefined (falls back to defaultSort) for anything
  // not recognized, rather than throwing, so an unrecognized ?sortBy= is a
  // silent no-op instead of a 400 on an otherwise-valid list request.
  buildSort(field, order) {
    if (!field) return undefined;
    const key = field === 'id' ? '_id' : field;
    if (key !== '_id' && key !== 'created_at' && !this.columns.includes(key)) return undefined;
    return { [key]: order === 'desc' ? -1 : 1 };
  }

  async findById(id) {
    if (!this._isPrimitive(id)) return null;
    const doc = await this.collection.findOne({ _id: id });
    return this._toEntity(doc);
  }

  // Batches what would otherwise be N sequential findById calls (e.g.
  // resolving a list of foreign-key references) into a single $in query —
  // see student.service.js#dashboard for the call site this was added for.
  async findByIds(ids) {
    if (!Array.isArray(ids)) return [];
    const uniqueIds = [...new Set(ids)].filter((id) => Boolean(id) && this._isPrimitive(id));
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
    if (!this._isPrimitive(id)) return null;
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
    if (!this._isPrimitive(id)) return false;
    const { deletedCount } = await this.collection.deleteOne({ _id: id });
    return deletedCount > 0;
  }
}

module.exports = BaseRepository;
