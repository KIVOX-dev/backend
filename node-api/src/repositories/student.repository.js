const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/student.model');
const { escapeRegex } = require('../utils/regex');

class StudentRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  findByUserId(userId) {
    return this.findOne({ user_id: userId });
  }

  findByRollNumber(rollNumber) {
    return this.findOne({ roll_number: rollNumber });
  }

  // Ported from python-service's students.py list_students, which searches by
  // name/email (fields that live on the user, not the enrollment row) and
  // filters by department (also on the user). BaseRepository's filter
  // builder only does exact-match on whitelisted columns, so this needs a
  // real $lookup join — not something worth generalizing into BaseRepository
  // for the one caller that needs it.
  // `limit` intentionally has no page/skip counterpart — every caller of this
  // method (student.service.js#list, backing the admin/faculty student
  // search screens) renders the full result set with no "load more"/page
  // control in the frontend, so paginating here would silently hide rows
  // with no way for the current UI to reach them. `total` still reports the
  // *true* match count (via $facet, not `rows.length`) so a truncated result
  // is at least visible in the response metadata instead of silently lying
  // about having returned everything.
  async searchWithUsers({ institutionId, search, department, batchYear, limit = 100 }) {
    const match = {};
    if (institutionId) match.institution_id = institutionId;
    if (batchYear) match.batch_year = batchYear;

    const pipeline = [
      { $match: match },
      { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
    ];

    const userMatch = {};
    if (department) userMatch['user.department'] = department;
    if (search) {
      // escapeRegex guards against both regex-injection (a search string
      // containing regex metacharacters changing the query's meaning) and
      // ReDoS (pathological patterns causing catastrophic backtracking) —
      // see utils/regex.js.
      const safeSearch = escapeRegex(search);
      userMatch.$or = [
        { 'user.full_name': { $regex: safeSearch, $options: 'i' } },
        { 'user.email': { $regex: safeSearch, $options: 'i' } },
      ];
    }
    if (Object.keys(userMatch).length > 0) pipeline.push({ $match: userMatch });

    pipeline.push({ $sort: { 'user.full_name': 1 } });
    pipeline.push({
      $facet: {
        rows: [{ $limit: limit }],
        totalCount: [{ $count: 'count' }],
      },
    });

    const [result] = await this.collection.aggregate(pipeline).toArray();
    const docs = result?.rows || [];
    const total = result?.totalCount?.[0]?.count || 0;
    const rows = docs.map(({ _id, user, ...rest }) => ({
      id: _id,
      ...rest,
      full_name: user.full_name,
      email: user.email,
      department: user.department,
    }));
    return { rows, total };
  }
}

module.exports = new StudentRepository();
