// Backfills any institution whose departments collection is missing rows
// from the catalog — new institutions get this automatically now (see
// institution.service.js#create), so this script exists for institutions
// created before that, or through any other path that skipped it.
//
// Idempotent: skips any (institution, department name) pair that already
// exists.
// Usage: node scripts/seedDepartments.js
const { connect, close } = require('../src/config/database');
const institutionRepository = require('../src/repositories/institution.repository');
const departmentRepository = require('../src/repositories/department.repository');
const logger = require('../src/utils/logger');
const { getDepartmentNames, inferCollegeType, codeFor, uniqueCode } = require('../src/utils/departmentCatalog');

async function main() {
  await connect();

  const { rows: institutions } = await institutionRepository.findAll({ page: 1, limit: 1000 });
  if (institutions.length === 0) {
    logger.info('No institutions found — nothing to seed.');
    await close();
    process.exit(0);
  }

  for (const institution of institutions) {
    const names = getDepartmentNames(institution.name);
    const existingDepts = await departmentRepository.findByInstitutionId(institution.id);
    const existingNames = new Set(existingDepts.map((d) => d.name));
    const usedCodes = new Set(existingDepts.map((d) => d.code));

    let created = 0;
    for (const name of names) {
      if (existingNames.has(name)) continue;
      const code = uniqueCode(codeFor(name), usedCodes);
      usedCodes.add(code);
      await departmentRepository.create({ institution_id: institution.id, name, code });
      created += 1;
    }
    logger.info(`Seeded departments for institution: ${institution.name}`, {
      inferredType: inferCollegeType(institution.name),
      created,
      alreadyPresent: existingNames.size,
    });
  }

  logger.info('Department seeding complete');
  await close();
  process.exit(0);
}

main().catch((err) => {
  logger.error('Department seeding failed', { error: err.message });
  process.exit(1);
});
