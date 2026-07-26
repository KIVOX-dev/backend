const userDataRepository = require('../repositories/userData.repository');

// No admin/list surface exists for this on purpose — it's an opaque per-user
// blob, not a domain entity, so there's nothing here worth BaseService's
// list/getById/create/update/remove beyond the two operations below.
class UserDataService {
  async getForUser(actor) {
    const existing = await userDataRepository.findByUserId(actor.id);
    return { data: existing ? existing.data : {} };
  }

  // Full overwrite, no merge — matches python-service's persistence.py exactly.
  async saveForUser(actor, data) {
    const existing = await userDataRepository.findByUserId(actor.id);
    if (existing) {
      await userDataRepository.updateById(existing.id, { data });
    } else {
      await userDataRepository.create({ user_id: actor.id, data });
    }
    return { data };
  }
}

module.exports = new UserDataService();
