const { randomUUID } = require('node:crypto');
const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/questionExplanation.model');

class QuestionExplanationRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults });
  }

  async findByKeys(keys) {
    if (keys.length === 0) return [];
    const docs = await this.collection.find({ key: { $in: keys } }).toArray();
    return docs.map((d) => this._toEntity(d));
  }

  // Upsert on the unique key: two students finishing the same session at once
  // would otherwise race into a duplicate-key error on the second insert.
  async saveByKey(key, fields) {
    const now = new Date();
    await this.collection.updateOne(
      { key },
      { $set: { ...this._pickFields(fields), updated_at: now }, $setOnInsert: { _id: randomUUID(), created_at: now } },
      { upsert: true }
    );
  }
}

module.exports = new QuestionExplanationRepository();
