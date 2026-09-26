const BaseRepository = require('./BaseRepository');
const { tableName, columns } = require('../models/roadmapSkillCache.model');

class RoadmapSkillCacheRepository extends BaseRepository {
  constructor() {
    super(tableName, columns);
  }

  findBySkill(skillName) {
    return this.findOne({ skill_name: skillName });
  }

  async upsertForSkill(skillName, playlists) {
    const existing = await this.findBySkill(skillName);
    if (existing) {
      return this.updateById(existing.id, { playlists, fetched_at: new Date() });
    }
    return this.create({ skill_name: skillName, playlists, fetched_at: new Date() });
  }
}

module.exports = new RoadmapSkillCacheRepository();
