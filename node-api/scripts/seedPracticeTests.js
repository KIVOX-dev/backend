// Seeds the 4 open self-serve practice-category `tests` rows (one set per
// institution) from the real question content already proven working in the
// frontend's public/*.json files — see test.service.js#list for how the
// `category` field this sets is what makes these visible to every student
// unconditionally, unlike a regular admin-authored test. Idempotent: skips
// any institution that already has a given category seeded.
// Usage: node scripts/seedPracticeTests.js
const fs = require('fs');
const path = require('path');
const { connect, close } = require('../src/config/database');
const testRepository = require('../src/repositories/test.repository');
const institutionRepository = require('../src/repositories/institution.repository');
const logger = require('../src/utils/logger');

// Paths relative to this backend repo, pointing at the frontend's existing
// public/*.json — these are the real, already-in-use question banks; the
// backend's own src/mcq_data/*.json files are stale/smaller and not used.
const FRONTEND_PUBLIC_DIR = path.resolve(__dirname, '../../../Upscaler-frontend/public');

const CATEGORIES = [
  { category: 'quantitative', title: 'Quantitative Aptitude Practice', file: 'quantitative_mcq.json' },
  { category: 'logical', title: 'Logical Reasoning Practice', file: 'logical_mcq_500.json' },
  { category: 'verbal', title: 'Verbal Ability Practice', file: 'verbal_json_20260418_40a84d.json' },
  { category: 'data_interpretation', title: 'Data Interpretation Practice', file: 'datainterpretation_json_20260418_efaa7a.json' },
];

function loadQuestionCount(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const questions = Array.isArray(raw) ? raw : raw.questions || [];
  return { raw, count: questions.length };
}

async function main() {
  await connect();

  const { rows: institutions } = await institutionRepository.findAll({ page: 1, limit: 1000 });
  if (institutions.length === 0) {
    logger.info('No institutions found — nothing to seed. Create an institution first.');
    await close();
    process.exit(0);
  }

  for (const { category, title, file } of CATEGORIES) {
    const filePath = path.join(FRONTEND_PUBLIC_DIR, file);
    if (!fs.existsSync(filePath)) {
      logger.error(`Question file missing, skipping category: ${category}`, { filePath });
      continue;
    }
    const { raw, count } = loadQuestionCount(filePath);
    const description = JSON.stringify(raw);

    for (const institution of institutions) {
      const existing = await testRepository.findOne({ institution_id: institution.id, category });
      if (existing) {
        logger.info(`Already seeded, skipping: ${category} @ ${institution.name}`);
        continue;
      }
      await testRepository.create({
        institution_id: institution.id,
        title,
        description,
        test_type: 'mcq',
        duration_minutes: 30,
        total_marks: count,
        difficulty: 'medium',
        category,
        status: 'active',
      });
      logger.info(`Seeded: ${category} @ ${institution.name}`, { questions: count });
    }
  }

  logger.info('Practice test seeding complete');
  await close();
  process.exit(0);
}

main().catch((err) => {
  logger.error('Practice test seeding failed', { error: err.message });
  process.exit(1);
});
