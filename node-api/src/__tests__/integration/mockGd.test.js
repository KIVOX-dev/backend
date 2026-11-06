const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// GD endpoints: topic bank, engine-driven next turn (ai-service mocked), interrupt check,
// and access control (owner-only, round 2 only).
describe('mock GD endpoints', () => {
  let app;
  let database;
  let repos;
  let ai;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const student = (text, extra = {}) => ({ speaker: 'You', is_student: true, text, duration_ms: 4000, ...extra });
  const turnBody = (over = {}) => ({ topic: 'Remote work', turns: [student('hello')], elapsed_ms: 60000, student_silent_ms: 2000, ...over });

  async function makeStudent(inst, tag) {
    const { user, password } = await seedUser(repos.userRepository, repos.hashPassword, {
      role: 'student', institutionId: inst.id, email: `${tag}-${Date.now()}@example.com`,
    });
    await repos.studentRepository.create({ user_id: user.id, institution_id: inst.id });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    return res.body.data.accessToken;
  }
  const newSession = async (t) => (await request(app).post('/api/v1/mock-sessions').set(auth(t)).send({ role: 'SE' }).expect(201)).body.data.id;
  const toRound2 = async (t, id) =>
    request(app).post(`/api/v1/mock-sessions/${id}/rounds/1`).set(auth(t))
      .send({ items: [{ question: 'q', correct_answer: 'a', selected: 'a' }] }).expect(200);

  beforeAll(async () => {
    repos = await buildTestApp();
    ({ app, database } = repos);
    ai = require('../../utils/aiServiceClient');
    jest.spyOn(ai, 'callAiService').mockImplementation(async (_p, body) => ({ source: 'ai', text: `${body.bot_name} speaks (${body.phase})` }));
    const inst = await seedInstitution(repos.institutionRepository, { code: `GD-${Date.now()}` });
    repos.t1 = await makeStudent(inst, 'gd1');
    repos.t2 = await makeStudent(inst, 'gd2');
  });
  afterAll(async () => teardownTestApp(database));

  it('serves the topic bank, filtered, and a random topic', async () => {
    const list = await request(app).get('/api/v1/mock-sessions/gd/topics?category=abstract&difficulty=easy').set(auth(repos.t1)).expect(200);
    expect(list.body.data.topics.length).toBeGreaterThan(0);
    expect(list.body.data.topics.every((t) => t.category === 'abstract' && t.difficulty === 'easy')).toBe(true);
    const rnd = await request(app).get('/api/v1/mock-sessions/gd/topics?random=true').set(auth(repos.t1)).expect(200);
    expect(rnd.body.data.topic.topic).toBeTruthy();
    await request(app).get('/api/v1/mock-sessions/gd/topics?category=bogus').set(auth(repos.t1)).expect(400);
  });

  it('only works once Round 2 is active, and only for the owner', async () => {
    const id = await newSession(repos.t1);
    await request(app).post(`/api/v1/mock-sessions/${id}/gd/turn`).set(auth(repos.t1)).send(turnBody()).expect(400); // still round 1
    await toRound2(repos.t1, id);
    await request(app).post(`/api/v1/mock-sessions/${id}/gd/turn`).set(auth(repos.t2)).send(turnBody()).expect(403);
    await request(app).post(`/api/v1/mock-sessions/${id}/gd/turn`).send(turnBody()).expect(401);
  });

  it('returns a bot line from the engine + ai-service, and waits when the student should speak', async () => {
    const id = await newSession(repos.t1);
    await toRound2(repos.t1, id);
    const speak = await request(app).post(`/api/v1/mock-sessions/${id}/gd/turn`).set(auth(repos.t1)).send(turnBody()).expect(200);
    expect(speak.body.data.action).toBe('speak');
    expect(speak.body.data.bot.slot).toMatch(/^bot[0-3]$/);
    expect(speak.body.data.text).toContain('speaks');
    const bots = [{ speaker: 'Kiran', is_student: false, text: 'x' }, { speaker: 'Deep', is_student: false, text: 'y' }];
    const wait = await request(app).post(`/api/v1/mock-sessions/${id}/gd/turn`).set(auth(repos.t1))
      .send(turnBody({ turns: [student('hi'), ...bots] })).expect(200);
    expect(wait.body.data.action).toBe('wait');
    const nudge = await request(app).post(`/api/v1/mock-sessions/${id}/gd/turn`).set(auth(repos.t1))
      .send(turnBody({ turns: [student('hi'), bots[0]], student_silent_ms: 30000 })).expect(200);
    expect(nudge.body.data).toMatchObject({ action: 'speak', phase: 'nudge' });
    expect(nudge.body.data.bot.slot).toBe('bot3');
  });

  it('falls back to a local line if ai-service is down, so the discussion never stalls', async () => {
    const id = await newSession(repos.t1);
    await toRound2(repos.t1, id);
    ai.callAiService.mockRejectedValueOnce(new Error('down'));
    const res = await request(app).post(`/api/v1/mock-sessions/${id}/gd/turn`).set(auth(repos.t1)).send(turnBody()).expect(200);
    expect(res.body.data.action).toBe('speak');
    expect(res.body.data.source).toBe('fallback');
    expect(res.body.data.text.length).toBeGreaterThan(5);
  });

  it('scores references server-side and rejects interrupt checks outside round 2', async () => {
    const id = await newSession(repos.t1);
    await request(app).post(`/api/v1/mock-sessions/${id}/gd/interrupt-check`).set(auth(repos.t1)).send({ topic: 'T', turns: [], student_speaking_ms: 30000 }).expect(400);
    await toRound2(repos.t1, id);
    const ok = await request(app).post(`/api/v1/mock-sessions/${id}/gd/interrupt-check`).set(auth(repos.t1)).send({ topic: 'T', turns: [], student_speaking_ms: 3000 }).expect(200);
    expect(ok.body.data.interrupt).toBe(false);
    // A long student turn can be cut in on by the Dominator (the only interrupter), line included.
    const mathRandom = jest.spyOn(Math, 'random').mockReturnValue(0.01);
    const cut = await request(app).post(`/api/v1/mock-sessions/${id}/gd/interrupt-check`).set(auth(repos.t1))
      .send({ topic: 'T', turns: [student('a long point')], student_speaking_ms: 30000 }).expect(200);
    mathRandom.mockRestore();
    expect(cut.body.data).toMatchObject({ interrupt: true });
    expect(cut.body.data.bot.id).toBe('dominator');
    expect(cut.body.data.text).toContain('Kiran');
    const r2 = await request(app).post(`/api/v1/mock-sessions/${id}/rounds/2`).set(auth(repos.t1))
      .send({ topic: 'T', turns: [student('I agree with Deep on this', { references_other: false })] }).expect(200);
    expect(r2.body.data.round.payload.metrics.references_to_others).toBe(1);
  });
});
