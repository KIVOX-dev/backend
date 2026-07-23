const { query } = require('../config/database');

// Generic CRUD repository shared by every entity module.
// `tableName` is always a hardcoded string from module code (never request input),
// and `columns` is a fixed whitelist of column names — this is what keeps dynamic
// SQL building here safe: only whitelisted column *names* are interpolated, every
// *value* is still passed through parameterized placeholders ($1, $2, ...).
class BaseRepository {
  constructor(tableName, columns, { defaultOrderBy = 'created_at DESC' } = {}) {
    this.tableName = tableName;
    this.columns = columns;
    this.defaultOrderBy = defaultOrderBy;
  }

  _buildWhere(filters = {}) {
    const keys = Object.keys(filters).filter(
      (k) => filters[k] !== undefined && (this.columns.includes(k) || k === 'id')
    );
    if (keys.length === 0) return { clause: '', values: [] };
    const values = keys.map((k) => filters[k]);
    const clause = 'WHERE ' + keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
    return { clause, values };
  }

  async findAll({ page = 1, limit = 20, filters = {} } = {}) {
    const offset = (page - 1) * limit;
    const { clause, values } = this._buildWhere(filters);
    const dataSql = `SELECT * FROM ${this.tableName} ${clause} ORDER BY ${this.defaultOrderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    const countSql = `SELECT COUNT(*)::int AS total FROM ${this.tableName} ${clause}`;
    const [dataResult, countResult] = await Promise.all([
      query(dataSql, [...values, limit, offset]),
      query(countSql, values),
    ]);
    return { rows: dataResult.rows, total: countResult.rows[0].total, page, limit };
  }

  async findById(id) {
    const { rows } = await query(`SELECT * FROM ${this.tableName} WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  async findOne(filters) {
    const { clause, values } = this._buildWhere(filters);
    if (!clause) return null;
    const { rows } = await query(`SELECT * FROM ${this.tableName} ${clause} LIMIT 1`, values);
    return rows[0] || null;
  }

  async create(data) {
    const cols = Object.keys(data).filter((k) => this.columns.includes(k));
    const values = cols.map((c) => data[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const sql = `INSERT INTO ${this.tableName} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const { rows } = await query(sql, values);
    return rows[0];
  }

  async updateById(id, data) {
    const cols = Object.keys(data).filter((k) => this.columns.includes(k));
    if (cols.length === 0) return this.findById(id);
    const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const values = cols.map((c) => data[c]);
    const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE id = $${cols.length + 1} RETURNING *`;
    const { rows } = await query(sql, [...values, id]);
    return rows[0] || null;
  }

  async deleteById(id) {
    const { rowCount } = await query(`DELETE FROM ${this.tableName} WHERE id = $1`, [id]);
    return rowCount > 0;
  }
}

module.exports = BaseRepository;
