const crypto = require('node:crypto');
const questionExplanationRepository = require('../repositories/questionExplanation.repository');
const { callAiService, AiServiceUnavailableError } = require('../utils/aiServiceClient');
const logger = require('../utils/logger');

// Stable identity of a question: its text, shown data, answer key and option
// set (order-insensitive).
function keyFor(item) {
  const payload = JSON.stringify([
    item.question.trim(),
    (item.data_presentation || '').trim(),
    item.correct_answer.trim(),
    [...item.options].map((o) => o.trim()).sort(),
  ]);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

const toResult = (row) => ({ text: row.text, disputed: Boolean(row.disputed), suggested_answer: row.suggested_answer || null });
const EMPTY = { text: null, disputed: false, suggested_answer: null };

// Explanations for a list of practice questions, in the same order. Cached
// ones come straight from the database; the rest go to the AI service in one
// call and are cached for the next student. If the AI service is down the
// uncached ones come back empty instead of failing the whole results screen.
async function explain(items) {
  const keys = items.map(keyFor);
  const cached = new Map((await questionExplanationRepository.findByKeys([...new Set(keys)])).map((r) => [r.key, r]));

  const missing = [];
  const seen = new Set();
  items.forEach((item, i) => {
    if (!cached.has(keys[i]) && !seen.has(keys[i])) {
      seen.add(keys[i]);
      missing.push(i);
    }
  });

  let source = missing.length === 0 ? 'cache' : 'ai';
  if (missing.length > 0) {
    try {
      const res = await callAiService('/v1/practice/explain', { questions: missing.map((i) => items[i]) });
      const list = Array.isArray(res && res.explanations) ? res.explanations : [];
      let produced = 0;
      for (let n = 0; n < missing.length; n += 1) {
        const e = list[n];
        if (!e || !e.text) continue;
        produced += 1;
        const fields = { text: e.text, disputed: Boolean(e.disputed), suggested_answer: e.suggested_answer || null };
        cached.set(keys[missing[n]], fields);
        await questionExplanationRepository.saveByKey(keys[missing[n]], fields);
      }
      if (produced === 0) source = 'unavailable';
    } catch (err) {
      const msg = err instanceof AiServiceUnavailableError ? 'AI service unreachable, no explanations generated' : 'Question explanation failed';
      logger.error(msg, { error: err.message });
      source = 'unavailable';
    }
  }

  const explanations = keys.map((k) => (cached.has(k) ? toResult(cached.get(k)) : EMPTY));
  // Some cached, AI down for the rest: still useful, so say so.
  if (source === 'unavailable' && explanations.some((e) => e.text)) source = 'partial';
  return { source, explanations };
}

module.exports = { explain, keyFor };
