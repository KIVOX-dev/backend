const { callAiService, AiServiceUnavailableError } = require('../utils/aiServiceClient');
const logger = require('../utils/logger');

// Last-resort circuit breaker only — used exclusively when the AI service
// itself can't be reached at all. The AI service owns the "real" fallback
// decision (Groq configured or not) internally; see
// ai-service/app/routers/interview.py's own copy of this pool, which is what
// actually serves most fallback traffic in practice.
const FALLBACK_QUESTION_POOL = [
  'What are the key differences between React and Angular?',
  'Explain the concept of closures in JavaScript.',
  'How would you optimize a slow-performing database query?',
  'Describe a time you had to resolve a conflict within your team.',
  'What is the difference between TCP and UDP?',
];

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function localFallbackQuestions(role, company) {
  const selected = shuffle([...FALLBACK_QUESTION_POOL, ...FALLBACK_QUESTION_POOL]);
  return selected.map((q, i) => ({
    id: i + 1,
    text: `[${company.toUpperCase()} - ${role.toUpperCase()}] ${q}`,
    time_limit_seconds: 60,
    type: 'technical',
  }));
}

async function generateQuestions(role, company = 'general') {
  try {
    return await callAiService('/v1/interview/generate-questions', { role, company });
  } catch (err) {
    if (!(err instanceof AiServiceUnavailableError)) throw err;
    logger.error('AI service unreachable, using local fallback questions', { error: err.message });
    return localFallbackQuestions(role, company);
  }
}

module.exports = { generateQuestions };
