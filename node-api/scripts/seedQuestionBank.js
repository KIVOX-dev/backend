// Seeds the real question bank (500/500/500/300 questions per category,
// copied in from the frontend's public/*.json — see src/mcq_data/*.json)
// into the `questions` collection as individual rows, one per question,
// tagged with `category`. This is what testAssignment.service.js#create
// draws a random per-student subset from via questionRepository.sampleRandom.
// Idempotent: skips a category if it already has rows.
// Usage: node scripts/seedQuestionBank.js
const fs = require('fs');
const path = require('path');
const { connect, close } = require('../src/config/database');
const questionRepository = require('../src/repositories/question.repository');
const logger = require('../src/utils/logger');

const MCQ_DATA_DIR = path.resolve(__dirname, '../src/mcq_data');

const CATEGORIES = [
  { category: 'quantitative', file: 'quantitative.json' },
  { category: 'logical', file: 'logical.json' },
  { category: 'verbal', file: 'verbal.json' },
  { category: 'data_interpretation', file: 'data_interpretation.json' },
];

async function main() {
  await connect();

  for (const { category, file } of CATEGORIES) {
    const existing = await questionRepository.findOne({ category });
    if (existing) {
      logger.info(`Already seeded, skipping category: ${category}`);
      continue;
    }

    const filePath = path.join(MCQ_DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      logger.error(`Question file missing, skipping category: ${category}`, { filePath });
      continue;
    }
    const questions = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    let count = 0;
    for (const q of questions) {
      await questionRepository.create({
        category,
        question: q.question,
        data_presentation: q.data_presentation || null,
        options: q.options,
        answer: q.answer,
      });
      count += 1;
    }
    logger.info(`Seeded question bank category: ${category}`, { count });
  }

  logger.info('Question bank seeding complete');
  await close();
  process.exit(0);
}

main().catch((err) => {
  logger.error('Question bank seeding failed', { error: err.message });
  process.exit(1);
});
