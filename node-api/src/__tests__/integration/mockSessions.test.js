const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// 3-round mock interview: strict order, NO gating on scores, round results visible after each
// round, final report only after round 3, and tenant/ownership access control on every route.
describe('mock sessions', () => {
  let app;
  let database;
  let repos;
  const ctx = {};

  const mcq = (selected) => ({
    items: [
      { question: 'q1', section: 'Quant', options: ['a', 'b'], selected, correct_answer: 'a', explanation: 'because' },
      { question: 'q2', section: 'Verbal', options: ['a', 'b'], selected, correct_answer: 'b' },
    ],
  });
  const gd = {
    topic: 'Remote work',
    category: 'current_affairs',
    difficulty: 'easy',
    turns: [
      { speaker: 'You', is_student: true, text: 'I will start with um productivity', duration_ms: 8000 },
      { speaker: 'Mediator', text: 'Good point', duration_ms: 4000 },
      { speaker: 'You', is_student: true, text: 'Building on what the Fact Quoter said', references_other: true, phase: 'closing', duration_ms: 6000 },
    ],
  };
  const hr = { pairs: [{ question: 'Tell me about yourself', answer: 'I am a student who learned a lot because of projects' }] };

  async function makeStudent(institution, tag) {
    const { user, password } = await seedUser(repos.userRepository, repos.hashPassword, {
      role: 'student', institutionId: institution.id, email: `${tag}-${Date.now()}@example.com`,
    });
    await repos.studentRepository.create({ user_id: user.id, institution_id: institution.id });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    return { user, token: res.body.data.accessToken };
  }
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const built = await buildTestApp();
    jest.spyOn(require('../../utils/aiServiceClient'), 'callAiService').mockRejectedValue(new Error('ai-service down in tests'));
    ({ app, database } = built);
    repos = built;
    const instA = await seedInstitution(built.institutionRepository, { code: `MS-A-${Date.now()}` });
    const instB = await seedInstitution(built.institutionRepository, { code: `MS-B-${Date.now()}` });
    ctx.s1 = await makeStudent(instA, 's1');
    ctx.s2 = await makeStudent(instA, 's2');
    const { user, password } = await seedUser(built.userRepository, built.hashPassword, {
      role: 'institution_admin', institutionId: instA.id, email: `adminA-${Date.now()}@example.com`,
    });
    ctx.adminA = (await request(app).post('/api/v1/auth/login').send({ email: user.email, password })).body.data.accessToken;
    const other = await seedUser(built.userRepository, built.hashPassword, {
      role: 'institution_admin', institutionId: instB.id, email: `adminB-${Date.now()}@example.com`,
    });
    ctx.adminB = (await request(app).post('/api/v1/auth/login').send({ email: other.user.email, password: other.password })).body.data.accessToken;
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function start(token) {
    const res = await request(app).post('/api/v1/mock-sessions').set(auth(token)).send({ role: 'Software Engineer', company: 'TCS' }).expect(201);
    return res.body.data.id;
  }

  it('lets a student finish all 3 rounds in order whatever they score (no gating)', async () => {
    const id = await start(ctx.s1.token);
    // Round 1 with every answer wrong -> score 0, round 2 must still be allowed.
    const r1 = await request(app).post(`/api/v1/mock-sessions/${id}/rounds/1`).set(auth(ctx.s1.token)).send(mcq('zzz')).expect(200);
    expect(r1.body.data.round.overall_score).toBe(0);
    expect(r1.body.data.round.payload.review).toHaveLength(2);
    expect(r1.body.data.round.payload.topic_scores).toHaveLength(2);
    expect(r1.body.data.session.final_report).toBeNull();
    const r2 = await request(app).post(`/api/v1/mock-sessions/${id}/rounds/2`).set(auth(ctx.s1.token)).send(gd).expect(200);
    expect(r2.body.data.round.payload.metrics.references_to_others).toBe(1);
    expect(r2.body.data.round.payload.transcript).toHaveLength(3);
    expect(r2.body.data.session.final_report).toBeNull();
    const r3 = await request(app).post(`/api/v1/mock-sessions/${id}/rounds/3`).set(auth(ctx.s1.token)).send(hr).expect(200);
    expect(r3.body.data.session.status).toBe('completed');
    expect(r3.body.data.session.final_report).toBeTruthy();
    const full = await request(app).get(`/api/v1/mock-sessions/${id}`).set(auth(ctx.s1.token)).expect(200);
    expect(full.body.data.rounds).toHaveLength(3);
    // The consolidated report is built from the stored rounds and only exists once completed.
    const report = full.body.data.final_report;
    expect(report.attempt_id).toBe(id);
    expect(report.round_scores[1]).toBe(0);
    expect(report.rounds).toHaveLength(3);
    expect(report.suggestions.length).toBeGreaterThan(0);
    expect(report.suggestions.every((x) => x.text && x.action)).toBe(true);
    expect(report.gd_metrics).toBeTruthy();
  });

  it('enforces round order and rejects replays', async () => {
    const id = await start(ctx.s1.token);
    await request(app).post(`/api/v1/mock-sessions/${id}/rounds/2`).set(auth(ctx.s1.token)).send(gd).expect(400);
    await request(app).post(`/api/v1/mock-sessions/${id}/rounds/1`).set(auth(ctx.s1.token)).send(mcq('a')).expect(200);
    await request(app).post(`/api/v1/mock-sessions/${id}/rounds/1`).set(auth(ctx.s1.token)).send(mcq('a')).expect(400);
    await request(app).post(`/api/v1/mock-sessions/${id}/rounds/4`).set(auth(ctx.s1.token)).send({}).expect(400);
  });

  it('keeps a quit attempt as incomplete with finished rounds and no final report', async () => {
    const id = await start(ctx.s1.token);
    await request(app).post(`/api/v1/mock-sessions/${id}/rounds/1`).set(auth(ctx.s1.token)).send(mcq('a')).expect(200);
    await request(app).post(`/api/v1/mock-sessions/${id}/abandon`).set(auth(ctx.s1.token)).expect(200);
    const res = await request(app).get(`/api/v1/mock-sessions/${id}`).set(auth(ctx.s1.token)).expect(200);
    expect(res.body.data.status).toBe('incomplete');
    expect(res.body.data.rounds).toHaveLength(1);
    expect(res.body.data.final_report).toBeNull();
    await request(app).post(`/api/v1/mock-sessions/${id}/rounds/2`).set(auth(ctx.s1.token)).send(gd).expect(400);
  });

  it('isolates data: other students and other colleges are denied, own-college admin allowed', async () => {
    const id = await start(ctx.s1.token);
    await request(app).get(`/api/v1/mock-sessions/${id}`).set(auth(ctx.s2.token)).expect(403);
    await request(app).get(`/api/v1/mock-sessions/${id}`).set(auth(ctx.adminB)).expect(403);
    await request(app).get(`/api/v1/mock-sessions/${id}`).set(auth(ctx.adminA)).expect(200);
    // Admins and other students cannot write to someone else's attempt.
    await request(app).post(`/api/v1/mock-sessions/${id}/rounds/1`).set(auth(ctx.adminA)).send(mcq('a')).expect(403);
    await request(app).post(`/api/v1/mock-sessions/${id}/rounds/1`).set(auth(ctx.s2.token)).send(mcq('a')).expect(403);
    await request(app).post('/api/v1/mock-sessions').set(auth(ctx.adminA)).send({ role: 'x' }).expect(403);
    await request(app).get(`/api/v1/mock-sessions/${id}`).expect(401);
  });
});
