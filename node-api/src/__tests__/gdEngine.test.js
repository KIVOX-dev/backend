const engine = require('../utils/gdEngine');
const { pickTopic, TOPICS, CATEGORIES, DIFFICULTIES } = require('../config/gdTopics');

const base = { totalMs: 14 * 60 * 1000, elapsedMs: 60000, studentSilentMs: 0, studentName: 'Kavi' };
const student = (text = 'a point', duration_ms = 5000) => ({ speaker: 'You', is_student: true, text, duration_ms });
const bot = (name, phase = 'discussion') => ({ speaker: name, is_student: false, text: 'x', phase });

describe('gdEngine.planNext', () => {
  it('lets the student open first, then the moderator opens after the grace period', () => {
    expect(engine.planNext({ ...base, turns: [], studentSilentMs: 5000 }).action).toBe('wait');
    const p = engine.planNext({ ...base, turns: [], studentSilentMs: 16000 });
    expect(p).toMatchObject({ action: 'speak', phase: 'opening' });
    expect(p.bot.id).toBe('mediator');
  });

  it('never lets bots chain more than two turns without the student', () => {
    const turns = [student(), bot('Kiran'), bot('Deep')];
    expect(engine.planNext({ ...base, turns, studentSilentMs: 3000 }).action).toBe('wait');
  });

  it('never picks the same bot twice in a row', () => {
    for (let i = 0; i < 200; i += 1) {
      const p = engine.planNext({ ...base, turns: [student(), bot('Kiran')] }, Math.random);
      expect(p.action).toBe('speak');
      expect(p.bot.name).not.toBe('Kiran');
    }
  });

  it('has the moderator nudge a silent student, but not repeatedly', () => {
    const turns = [student(), bot('Kiran')];
    const nudge = engine.planNext({ ...base, turns, studentSilentMs: 26000 });
    expect(nudge).toMatchObject({ action: 'speak', phase: 'nudge', invite: 'Kavi' });
    expect(nudge.bot.id).toBe('mediator');
    const again = engine.planNext({ ...base, turns: [...turns, { ...bot('Ari', 'nudge') }], studentSilentMs: 30000 });
    expect(again.phase === 'nudge').toBe(false);
  });

  it('switches to the moderator closing summary in the last minute, once', () => {
    const turns = [student(), bot('Kiran')];
    const c = engine.planNext({ ...base, turns, elapsedMs: 14 * 60 * 1000 - 30000 });
    expect(c).toMatchObject({ action: 'speak', phase: 'closing' });
    expect(engine.planNext({ ...base, turns, elapsedMs: 14 * 60 * 1000 - 30000, closingDone: true }).action).toBe('wait');
  });
});

describe('gdEngine.shouldInterrupt', () => {
  it('only the Dominator interrupts, only after a long student turn, and respects the cooldown', () => {
    expect(engine.shouldInterrupt({ studentSpeakingMs: 5000 }, () => 0)).toBeNull();
    expect(engine.shouldInterrupt({ studentSpeakingMs: 25000, msSinceLastInterrupt: 10000 }, () => 0)).toBeNull();
    expect(engine.shouldInterrupt({ studentSpeakingMs: 25000, msSinceLastInterrupt: 200000 }, () => 0.9)).toBeNull();
    expect(engine.shouldInterrupt({ studentSpeakingMs: 25000, msSinceLastInterrupt: 200000 }, () => 0.1).id).toBe('dominator');
  });
});

describe('gdEngine.referencesOther', () => {
  it('detects building on others, by name or phrase', () => {
    expect(engine.referencesOther('I agree with Deep that costs matter')).toBe(true);
    expect(engine.referencesOther('Building on that, jobs will change')).toBe(true);
    expect(engine.referencesOther('Remote work is good for everyone')).toBe(false);
  });
});

describe('gdTopics', () => {
  it('covers every category x difficulty and filters', () => {
    for (const c of CATEGORIES) for (const d of DIFFICULTIES) expect(TOPICS.some((t) => t.category === c && t.difficulty === d)).toBe(true);
    for (let i = 0; i < 30; i += 1) expect(pickTopic({ category: 'abstract', difficulty: 'hard' }).category).toBe('abstract');
  });
});
