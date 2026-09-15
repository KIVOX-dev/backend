const userRepository = require('../repositories/user.repository');
const placementRepository = require('../repositories/placement.repository');
const placementRecordRepository = require('../repositories/placementRecord.repository');
const { ROLES } = require('../config/constants');

const RESULT_LIMIT = 8;

// Backs the institution admin/faculty shell's top-bar search ("Search
// users, placements, or drives..."). Three collections, each already
// institution-scoped by the individual repository methods this calls — see
// their own comments for why. super_admin gets an unscoped search across
// everything (institutionId is null in that case), matching how every
// other list endpoint in this app treats that role.
async function search(query, actor) {
  const institutionId = actor.role === ROLES.SUPER_ADMIN ? null : actor.institutionId;

  const [users, placements, placementRecords] = await Promise.all([
    userRepository.searchByNameOrEmail(query, institutionId, RESULT_LIMIT),
    placementRepository.searchByTitleOrCompany(query, institutionId, RESULT_LIMIT),
    placementRecordRepository.searchByCompanyOrRole(query, institutionId, RESULT_LIMIT),
  ]);

  return { users, placements, placement_records: placementRecords };
}

module.exports = { search };
