const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/achievement.model');

class AchievementRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  findByStudentId(studentId) {
    return this.findAll({ page: 1, limit: 1000, filters: { student_id: studentId } });
  }

  findByStudentIdAndType(studentId, achievementType) {
    return this.findOne({ student_id: studentId, achievement_type: achievementType });
  }
}

module.exports = new AchievementRepository();
