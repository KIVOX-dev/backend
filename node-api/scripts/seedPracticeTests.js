// Backfills the 4 open self-serve practice-category `tests` rows for every
// existing institution — idempotent, skips any institution that already has
// a given category seeded. New institutions get this automatically now (see
// institution.service.js#create -> utils/practiceBankSeed.js); this script
// is for backfilling institutions that existed before that, or recovering
// one whose auto-seed attempt failed (institution.service.js logs but
// doesn't block creation on it).
// Usage: node scripts/seedPracticeTests.js
const { connect, close } = require('../src/config/database');
const institutionRepository = require('../src/repositories/institution.repository');
const logger = require('../src/utils/logger');
const { seedPracticeBankForInstitution } = require('../src/utils/practiceBankSeed');

async function main() {
  await connect();

  const { rows: institutions } = await institutionRepository.findAll({ page: 1, limit: 1000 });
  if (institutions.length === 0) {
    logger.info('No institutions found — nothing to seed. Create an institution first.');
    await close();
    process.exit(0);
  }

  for (const institution of institutions) {
    await seedPracticeBankForInstitution(institution.id);
  }

  logger.info('Practice test seeding complete');
  await close();
  process.exit(0);
}

main().catch((err) => {
  logger.error('Practice test seeding failed', { error: err.message });
  process.exit(1);
});
