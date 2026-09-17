const BaseRepository = require('./BaseRepository');
const { tableName, columns, defaults } = require('../models/studentSkillBadge.model');

class StudentSkillBadgeRepository extends BaseRepository {
  constructor() {
    super(tableName, columns, { defaults, defaultOrderBy: { badge_count: -1 } });
  }

  findForStudent(studentId) {
    return this.collection
      .find({ student_id: studentId })
      .sort(this.defaultSort)
      .toArray()
      .then((docs) => docs.map((d) => this._toEntity(d)));
  }

  findOneForSkill(studentId, skillName) {
    return this.findOne({ student_id: studentId, skill_name: skillName });
  }
}

module.exports = new StudentSkillBadgeRepository();
