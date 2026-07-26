const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/student.model');

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
      userMatch.$or = [
        { 'user.full_name': { $regex: search, $options: 'i' } },
        { 'user.email': { $regex: search, $options: 'i' } },
      ];
    }
    if (Object.keys(userMatch).length > 0) pipeline.push({ $match: userMatch });

    pipeline.push({ $sort: { 'user.full_name': 1 } }, { $limit: limit });

    const docs = await this.collection.aggregate(pipeline).toArray();
    return docs.map(({ _id, user, ...rest }) => ({
      id: _id,
      ...rest,
      full_name: user.full_name,
      email: user.email,
      department: user.department,
    }));
  }
}

module.exports = new StudentRepository();
