module.exports = {
  tableName: 'questions',
  // Institution-agnostic bank shared by every college — the content itself
  // (e.g. "What is 25% of 80?") isn't institution-specific. `answer` is
  // sometimes an option letter ("B"), sometimes the full option text,
  // matching the shape already in public/*.json and the resolveAnswer()
  // helper on the frontend that already handles both.
  columns: ['category', 'question', 'data_presentation', 'options', 'answer'],
};
