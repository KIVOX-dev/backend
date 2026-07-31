const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/question.model');

class QuestionRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  // Draws `count` random questions from one category in one round trip.
  // $sample returns an independently-random subset AND order on every call —
  // exactly what gives each assigned student their own distinct pattern of
  // questions, with no extra shuffling logic needed on top.
  async sampleRandom(category, count) {
    const docs = await this.collection
      .aggregate([{ $match: { category } }, { $sample: { size: count } }])
      .toArray();
    return docs.map((d) => this._toEntity(d));
  }
}

module.exports = new QuestionRepository();
