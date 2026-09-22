// The 4 open self-serve practice-category `tests` rows every institution
// needs (quantitative/logical/verbal/data_interpretation — see
// test.model.js's `category` column comment). Previously only ever created
// by manually running scripts/seedPracticeTests.js against every
// institution — easy to forget for any college added afterward, exactly
// like departments used to be before institution.service.js#create started
// auto-seeding those too. This is the same fix for the same class of bug.
//
// Question banks are bundled into this repo (data/practiceQuestions/) rather
// than read from a sibling frontend checkout (scripts/seedPracticeTests.js
// used to resolve ../../../Upscaler-frontend/public/*.json) — that path
// only ever existed on a developer's machine with both repos checked out
// side by side, never inside the deployed container, so institution
// creation in production would have silently found nothing to seed.
const fs = require('fs');
const path = require('path');
const testRepository = require('../repositories/test.repository');
const logger = require('./logger');

const QUESTION_BANK_DIR = path.join(__dirname, '..', '..', 'data', 'practiceQuestions');

const PRACTICE_CATEGORIES = [
  { category: 'quantitative', title: 'Quantitative Aptitude Practice', file: 'quantitative_mcq.json' },
  { category: 'logical', title: 'Logical Reasoning Practice', file: 'logical_mcq_500.json' },
  { category: 'verbal', title: 'Verbal Ability Practice', file: 'verbal_json_20260418_40a84d.json' },
  { category: 'data_interpretation', title: 'Data Interpretation Practice', file: 'datainterpretation_json_20260418_efaa7a.json' },
];

function loadQuestionBank(file) {
  const filePath = path.join(QUESTION_BANK_DIR, file);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const questions = Array.isArray(raw) ? raw : raw.questions || [];
  return { raw, count: questions.length };
}

// Idempotent — skips any category this institution already has, same as the
// original script. Safe to call for every institution on every deploy, not
// just newly-created ones.
async function seedPracticeBankForInstitution(institutionId) {
  for (const { category, title, file } of PRACTICE_CATEGORIES) {
    const existing = await testRepository.findOne({ institution_id: institutionId, category });
    if (existing) continue;

    const { raw, count } = loadQuestionBank(file);
    await testRepository.create({
      institution_id: institutionId,
      title,
      description: JSON.stringify(raw),
      test_type: 'mcq',
      duration_minutes: 30,
      total_marks: count,
      difficulty: 'medium',
      category,
      status: 'active',
    });
    logger.info('Seeded practice-bank test', { institutionId, category, questions: count });
  }
}

module.exports = { PRACTICE_CATEGORIES, seedPracticeBankForInstitution };
