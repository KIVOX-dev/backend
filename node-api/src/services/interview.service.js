const { isGroqConfigured, groqComplete } = require('../utils/groqClient');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

// Ported from python-service's interviews.py#generate_questions. Note the
// fallback pool is only ever tagged "technical" (matching python exactly) —
// only the real Groq-generated path splits 7 technical / 3 behavioral.
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

async function generateQuestions(role, company = 'general') {
  if (!isGroqConfigured()) {
    const selected = shuffle([...FALLBACK_QUESTION_POOL, ...FALLBACK_QUESTION_POOL]);
    return selected.map((q, i) => ({
      id: i + 1,
      text: `[${company.toUpperCase()} - ${role.toUpperCase()}] ${q}`,
      time_limit_seconds: 60,
      type: 'technical',
    }));
  }

  const systemPrompt = `You are an expert technical interviewer at ${company} hiring for a ${role} position.`;
  const userPrompt = `Generate exactly 10 interview questions for this specific role and company.
Make them realistic, challenging, and a mix of technical (7) and behavioral (3) questions.
Return the result as a raw JSON object with a single key "questions" containing a list of strings.`;

  try {
    const result = await groqComplete({ systemPrompt, userPrompt, temperature: 0.7, maxTokens: 1024, jsonResponse: true });
    const questions = result.questions || [];
    if (questions.length < 10) throw new Error('LLM did not return enough questions');

    return questions.slice(0, 10).map((q, i) => ({
      id: i + 1,
      text: q,
      time_limit_seconds: 60,
      type: i < 7 ? 'technical' : 'behavioral',
    }));
  } catch (err) {
    logger.error('Interview question generation failed', { error: err.message });
    throw ApiError.internal(`Failed to generate questions: ${err.message}`);
  }
}

module.exports = { generateQuestions };
