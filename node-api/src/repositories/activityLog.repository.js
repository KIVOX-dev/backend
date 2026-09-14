const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/activityLog.model');

class ActivityLogRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  // Backs the GitHub-style activity heatmap (GET /auth/me/activity-heatmap)
  // — one row per calendar day this user logged in, in the given window.
  // Grouped in Mongo rather than in-app since a year of daily counts is a
  // handful of rows either way, but the raw login-event rows themselves can
  // be many times that.
  async countLoginsByDay(userId, since) {
    const rows = await this.collection
      .aggregate([
        { $match: { user_id: userId, action: 'login', created_at: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, count: { $sum: 1 } } },
      ])
      .toArray();
    return rows.map((r) => ({ date: r._id, count: r.count }));
  }
}

module.exports = new ActivityLogRepository();
