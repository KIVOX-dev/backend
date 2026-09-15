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
  //
  // Matches both 'login' (auth.service.js#login, password auth) and
  // 'google_login' (auth.service.js#googleLogin) — these are the same
  // product event ("this user logged in today") recorded under two action
  // names because they're two different code paths, not two different
  // things the heatmap should distinguish. Missing 'google_login' here
  // previously meant any user who only ever signs in via "Continue with
  // Google" saw a permanently empty heatmap.
  async countLoginsByDay(userId, since) {
    const rows = await this.collection
      .aggregate([
        { $match: { user_id: userId, action: { $in: ['login', 'google_login'] }, created_at: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, count: { $sum: 1 } } },
      ])
      .toArray();
    return rows.map((r) => ({ date: r._id, count: r.count }));
  }
}

module.exports = new ActivityLogRepository();
