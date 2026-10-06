// Cache of AI-written explanations for practice-bank questions. The bank files
// carry no explanations, and the same question is served to many students, so
// each distinct (question, options, answer) is explained once and reused.
// `key` is a hash of that content — a changed answer key gets a fresh explanation.
module.exports = {
  tableName: 'question_explanations',
  columns: ['key', 'text', 'disputed', 'suggested_answer'],
  defaults: { disputed: false },
};
