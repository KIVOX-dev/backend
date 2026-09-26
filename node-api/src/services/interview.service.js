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

// Non-technical rounds get their own last-resort pool so an HR round never
// falls back to coding questions. Keyed by the same ids as the AI service's
// ROUNDS table (ai-service/app/routers/interview.py).
const ROUND_FALLBACKS = {
  system_design: {
    type: 'system design',
    pool: [
      'Design a URL shortening service that handles millions of requests per day.',
      'How would you design a notification system that sends email, SMS and push messages?',
      'Design a rate limiter for a public API.',
      'How would you design the backend for a real-time chat application?',
      'Design a file upload service that supports very large files and resumable uploads.',
    ],
  },
  hr: {
    type: 'hr',
    pool: [
      'Tell me about yourself and your background.',
      'Why do you want to join our company?',
      'What are your greatest strengths and one weakness you are working on?',
      'Where do you see yourself in five years?',
      'Are you comfortable relocating or working in shifts if required?',
    ],
  },
  behavioral: {
    type: 'behavioral',
    pool: [
      'Tell me about a time you handled a conflict within your team.',
      'Describe a situation where you missed a deadline. What did you do?',
      'Tell me about a time you took ownership of a problem nobody else wanted.',
      'Describe a time you had to learn something new very quickly.',
      'Tell me about a mistake you made and what you learned from it.',
    ],
  },
  managerial: {
    type: 'managerial',
    pool: [
      'Your two most important tasks are both due today. How do you decide what to do first?',
      'How would you handle a teammate who is consistently missing their deadlines?',
      'A client asks for a change late in the project. How do you respond?',
      'Tell me about a decision you made with incomplete information.',
      'How do you keep stakeholders updated when a project is at risk?',
    ],
  },
  aptitude: {
    type: 'problem solving',
    pool: [
      'How many tennis balls could fit in this room? Walk me through your estimate.',
      'You have 8 identical balls and one is heavier. How do you find it with two weighings?',
      'How would you approach finding a bug that only happens once a week in production?',
      'Estimate how many cups of tea are sold in your city every day.',
      'You have a 3-litre and a 5-litre jug. How do you measure exactly 4 litres?',
    ],
  },
};

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function localFallbackQuestions(role, company, round) {
  const { type, pool } = ROUND_FALLBACKS[round] || { type: 'technical', pool: FALLBACK_QUESTION_POOL };
  const selected = shuffle([...pool, ...pool]);
  return selected.map((q, i) => ({
    id: i + 1,
    text: `[${company.toUpperCase()} - ${role.toUpperCase()}] ${q}`,
    time_limit_seconds: 60,
    type,
  }));
}

async function generateQuestions(role, company = 'general', round = 'technical') {
  try {
    return await callAiService('/v1/interview/generate-questions', { role, company, round });
  } catch (err) {
    if (!(err instanceof AiServiceUnavailableError)) throw err;
    logger.error('AI service unreachable, using local fallback questions', { error: err.message });
    return localFallbackQuestions(role, company, round);
  }
}

// Round 1 of the mock interview: a written MCQ test for this role at this
// company. Unlike generateQuestions there's no local pool that could be
// role- and company-specific, so an unreachable AI service is reported as
// source "unavailable" (same as the AI service's own failure answer) and
// the frontend falls back to its company aptitude banks.
async function generateMcq(role, company = 'general', count = 20) {
  try {
    return await callAiService('/v1/interview/generate-mcq', { role, company, count });
  } catch (err) {
    if (!(err instanceof AiServiceUnavailableError)) throw err;
    logger.error('AI service unreachable, MCQ round will use fallback banks', { error: err.message });
    return { source: 'unavailable', questions: [] };
  }
}

module.exports = { generateQuestions, generateMcq };
