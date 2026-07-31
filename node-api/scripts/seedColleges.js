// Seeds the initial Coimbatore-region college roster. Idempotent — skips any
// code that already exists, so it's safe to re-run. Usage: npm run db:seed-colleges
const { connect, close } = require('../src/config/database');
const institutionRepository = require('../src/repositories/institution.repository');
const logger = require('../src/utils/logger');

const COLLEGES = [
  { name: 'Nirmala College for Women', code: 'NCW', location: 'Coimbatore' },
  { name: 'PSGR Krishnammal College for Women', code: 'PSGRKCW', location: 'Coimbatore' },
  { name: 'A.G. Arts and Science College', code: 'AGASC', location: 'Tiruppur' },
  { name: 'Suguna College of Arts and Science', code: 'SCAS', location: 'Coimbatore' },
  { name: 'Suguna College of Engineering', code: 'SCE', location: 'Coimbatore' },
  { name: 'CMS College of Commerce', code: 'CMSCC', location: 'Coimbatore' },
  { name: 'Shankar College of Engineering and Technology', code: 'SCEC' },
  { name: 'Shankara College of Arts and Science', code: 'SKASC' },
  { name: 'VLB Janakiammal College of Arts and Science', code: 'VLBJCAS', location: 'Coimbatore' },
  { name: 'Nallamuthu Gounder Mahalingam College', code: 'NGMC', location: 'Pollachi' },
  { name: 'Bishop Ambrose College', code: 'BAC', location: 'Coimbatore' },
];

async function main() {
  await connect();

  for (const college of COLLEGES) {
    const existing = await institutionRepository.findOne({ code: college.code });
    if (existing) {
      logger.info(`Skipped (code already exists): ${college.code}`);
      continue;
    }
    await institutionRepository.create(college);
    logger.info(`Created institution: ${college.code} - ${college.name}`);
  }

  logger.info('College seed complete');
  await close();
  process.exit(0);
}

main().catch((err) => {
  logger.error('College seed failed', { error: err.message });
  process.exit(1);
});
