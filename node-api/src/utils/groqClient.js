const Groq = require('groq-sdk');
const env = require('../config/env');

// Matches the model python-service's ai.py/resume.py/interviews.py/assessments.py
// all use — kept as one constant so a future model bump happens in one place.
const MODEL = 'llama-3.3-70b-versatile';

let client = null;

function isGroqConfigured() {
  return Boolean(env.groq.apiKey);
}

function getClient() {
  if (!client) {
    if (!isGroqConfigured()) {
      throw new Error('GROQ_API_KEY is not configured');
    }
    client = new Groq({ apiKey: env.groq.apiKey });
  }
  return client;
}

// Callers decide how to react to a missing key (check isGroqConfigured() first) —
// python-service does this two different ways per endpoint (soft passthrough
// fallback in ai.py/interviews.py, hard 500 in resume.py), so that choice isn't
// baked into this wrapper.
async function groqComplete({ systemPrompt, userPrompt, temperature = 0.7, maxTokens = 1024, jsonResponse = false }) {
  const groq = getClient();
  const completion = await groq.chat.completions.create({
    model: MODEL,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    ...(jsonResponse ? { response_format: { type: 'json_object' } } : {}),
  });
  const content = completion.choices[0]?.message?.content || '';
  return jsonResponse ? JSON.parse(content) : content;
}

module.exports = { isGroqConfigured, groqComplete, MODEL };
