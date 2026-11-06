const { rulesReport, mergeAi } = require('../services/mockReport.service');

const session = { id: 'sess-1', role: 'Software Engineer', company: 'TCS', overall_score: 5.9, completed_at: new Date('2026-11-07') };
const rounds = [
  { round: 1, overall_score: 4, parameter_scores: { accuracy: 4 }, payload: { topic_scores: [{ section: 'Quant', score: 2 }, { section: 'Verbal', score: 8 }] } },
  {
    round: 2, overall_score: 5, payload: {
      topic: 'Remote work',
      metrics: { speaking_time_share: 12, student_turns: 2, interruptions_made: 0, interruptions_received: 1, references_to_others: 0, filler_words: 6, opened_discussion: false, concluded_discussion: false },
      transcript: [],
    },
    parameter_scores: { content_relevance: 7, communication_clarity: 4, initiative: 3, listening_building: 2, leadership_collaboration: 6, time_management_conclusion: 5 },
  },
  {
    round: 3, overall_score: 7, parameter_scores: { content_quality: 8, communication_confidence: 7, answer_structure: 4, relevance: 8, professionalism: 9, self_awareness: 5 },
    payload: { pairs: [
      { question: 'Tell me about yourself', answer: 'I am a student', score: 3, note: 'Add more detail' },
      { question: 'Why do you want to join TCS?', answer: 'Because TCS builds large systems and I like scale, for example my project used queues.', score: 8, note: 'Clear' },
      { question: 'Where do you see yourself?', answer: '', score: 0, note: 'missing' },
    ] },
  },
];

describe('rulesReport', () => {
  const report = rulesReport({ session, rounds, student: { roll_number: 'R1' }, user: { full_name: 'Kavi', email: 'k@x.com' } });

  it('carries identity, scores per round and the three round summaries', () => {
    expect(report).toMatchObject({ attempt_id: 'sess-1', role: 'Software Engineer', company: 'TCS', overall_score: 5.9 });
    expect(report.student).toMatchObject({ name: 'Kavi', email: 'k@x.com', roll_number: 'R1' });
    expect(report.round_scores).toEqual({ 1: 4, 2: 5, 3: 7 });
    expect(report.rounds.map((r) => r.title)).toEqual(['Written test', 'Group discussion', 'HR interview']);
    expect(report.rounds[1].improvements).toEqual(expect.arrayContaining(['Initiative', 'Listening & building on others']));
    expect(report.rounds[2].strengths).toEqual(expect.arrayContaining(['Professionalism']));
    expect(report.rounds[0].improvements).toContain('Quant');
    expect(report.gd_metrics.filler_words).toBe(6);
  });

  it('lists notable answers, best first, and never an unanswered one', () => {
    expect(report.notable_answers[0].question).toMatch(/join TCS/);
    expect(report.notable_answers.every((a) => a.answer.length > 0)).toBe(true);
  });

  it('finds missed opportunities in the GD and HR, each with a sample better line', () => {
    const gd = report.missed_opportunities.filter((m) => m.round === 2);
    expect(gd.length).toBe(3); // did not open, did not build on others, did not conclude
    const hr = report.missed_opportunities.filter((m) => m.round === 3);
    expect(hr.length).toBeGreaterThan(0);
    expect(hr[0].sample_better_line).toMatch(/Software Engineer/);
    expect(report.missed_opportunities.every((m) => m.moment && m.sample_better_line)).toBe(true);
  });

  it('gives suggestions that each have a concrete action, weakest areas first', () => {
    expect(report.suggestions.length).toBeGreaterThanOrEqual(4);
    expect(report.suggestions.every((s) => s.text && s.action)).toBe(true);
    expect(report.suggestions[0].area).toBe('Listening & building on others'); // lowest score (2)
    expect(report.suggestions.some((s) => /Quant/.test(s.text))).toBe(true);
  });

  it('never uses pass/fail or readiness wording', () => {
    expect(JSON.stringify(report)).not.toMatch(/\b(passed?|failed?|not ready|job.ready)\b/i);
  });
});

describe('mergeAi', () => {
  const base = rulesReport({ session, rounds, student: null, user: null });

  it('keeps the rules report when the AI is unavailable or malformed', () => {
    expect(mergeAi(base, { source: 'unavailable' })).toBe(base);
    expect(mergeAi(base, null)).toBe(base);
    const merged = mergeAi(base, { source: 'ai', suggestions: [{ text: 'only one', action: 'x' }], missed_opportunities: [{ round: 9, moment: 'm', sample_better_line: 's' }] });
    expect(merged.suggestions).toEqual(base.suggestions); // needs at least 2 valid
    expect(merged.missed_opportunities).toEqual(base.missed_opportunities);
  });

  it('adopts well-formed AI output', () => {
    const merged = mergeAi(base, {
      source: 'ai', strengths: ['Clear voice'], improvements: ['More examples'],
      suggestions: [{ text: 'Use STAR', action: 'Write 3 stories', area: 'Structure' }, { text: 'Open first', action: 'Open within 20s' }],
      missed_opportunities: [{ round: 3, moment: 'Thin intro', sample_better_line: 'I built X.' }],
    });
    expect(merged.source).toBe('ai');
    expect(merged.suggestions.map((s) => s.text)).toEqual(['Use STAR', 'Open first']);
    expect(merged.missed_opportunities).toEqual([{ round: 3, moment: 'Thin intro', sample_better_line: 'I built X.' }]);
    expect(merged.overall_strengths).toEqual(['Clear voice']);
  });
});
