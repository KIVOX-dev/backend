const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// The AI service isn't running in Jest; stand in for it so the caching and
// ordering logic can be exercised deterministically.
const mockCall = jest.fn();
jest.mock('../../utils/aiServiceClient', () => {
  class AiServiceUnavailableError extends Error {}
  class AiServiceUpstreamError extends Error {}
  return { callAiService: (...args) => mockCall(...args), mintServiceToken: () => 't', AiServiceUnavailableError, AiServiceUpstreamError };
});

const Q1 = { question: 'Which data structure uses LIFO?', options: ['Array', 'Stack', 'Graph', 'Queue'], correct_answer: 'Stack' };
const Q2 = { question: 'What is 15% of 200?', options: ['20', '30', '40', '25'], correct_answer: '30' };
const LIFO = 'LIFO means last in, first out — a stack.';

describe('POST /ai/explain-questions', () => {
  let app;
  let database;
  let token;
  const post = (body, t = token) => request(app).post('/api/v1/ai/explain-questions').set('Authorization', `Bearer ${t}`).send(body);

  beforeAll(async () => {
    const ctx = await buildTestApp();
    ({ app, database } = ctx);
    const institution = await seedInstitution(ctx.institutionRepository);
    const { user, password } = await seedUser(ctx.userRepository, ctx.hashPassword, { role: 'student', institutionId: institution.id, email: `exp-${Date.now()}@example.com` });
    token = (await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200)).body.data.accessToken;
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  beforeEach(() => mockCall.mockReset());

  it('requires login and validates the payload', async () => {
    await request(app).post('/api/v1/ai/explain-questions').send({ questions: [Q1] }).expect(401);
    await post({ questions: [] }).expect(400);
    await post({ questions: [{ ...Q1, options: ['only one'] }] }).expect(400);
    await post({ questions: Array(21).fill(Q1) }).expect(400);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('asks the AI service once, returns explanations in request order, and caches them', async () => {
    mockCall.mockResolvedValue({ source: 'ai', explanations: [{ text: LIFO }, { text: '0.15 x 200 = 30.', disputed: false }] });
    const res = await post({ questions: [Q1, Q2] }).expect(200);
    expect(res.body.data.source).toBe('ai');
    expect(res.body.data.explanations.map((e) => e.text)).toEqual([LIFO, '0.15 x 200 = 30.']);
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(mockCall.mock.calls[0][0]).toBe('/v1/practice/explain');

    // Second student / second visit: served from the database, no AI call.
    const again = await post({ questions: [Q2, Q1] }).expect(200);
    expect(again.body.data.source).toBe('cache');
    expect(again.body.data.explanations.map((e) => e.text)).toEqual(['0.15 x 200 = 30.', LIFO]);
    expect(mockCall).toHaveBeenCalledTimes(1);
  });

  it('only sends uncached, de-duplicated questions to the AI service', async () => {
    const Q3 = { question: 'Synonym of "rapid"?', options: ['Slow', 'Quick', 'Late', 'Tall'], correct_answer: 'Quick' };
    mockCall.mockResolvedValue({ source: 'ai', explanations: [{ text: 'Rapid means quick.' }] });
    const res = await post({ questions: [Q1, Q3, Q3] }).expect(200);
    expect(mockCall.mock.calls[0][1].questions).toEqual([Q3]);
    expect(res.body.data.explanations.map((e) => e.text)).toEqual([LIFO, 'Rapid means quick.', 'Rapid means quick.']);
  });

  it('treats a different answer key as a different question (no cache poisoning)', async () => {
    mockCall.mockResolvedValue({ source: 'ai', explanations: [{ text: 'A queue is FIFO (per this key).' }] });
    const res = await post({ questions: [{ ...Q1, correct_answer: 'Queue' }] }).expect(200);
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(res.body.data.explanations[0].text).not.toBe(LIFO);
  });

  it('keeps the disputed flag and suggested answer', async () => {
    const Q4 = { question: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correct_answer: '5' };
    mockCall.mockResolvedValue({ source: 'ai', explanations: [{ text: '2 + 2 is 4.', disputed: true, suggested_answer: '4' }] });
    const res = await post({ questions: [Q4] }).expect(200);
    expect(res.body.data.explanations[0]).toMatchObject({ disputed: true, suggested_answer: '4' });
  });

  it('degrades to empty explanations when the AI service is down, without failing', async () => {
    const { AiServiceUnavailableError } = require('../../utils/aiServiceClient');
    mockCall.mockRejectedValue(new AiServiceUnavailableError('down'));
    const Q5 = { question: 'Opposite of "hot"?', options: ['Cold', 'Warm', 'Mild', 'Spicy'], correct_answer: 'Cold' };
    const res = await post({ questions: [Q1, Q5] }).expect(200);
    expect(res.body.data.source).toBe('partial'); // Q1 cached, Q5 not
    expect(res.body.data.explanations[0].text).toBeTruthy();
    expect(res.body.data.explanations[1].text).toBeNull();
    const only = await post({ questions: [Q5] }).expect(200);
    expect(only.body.data.source).toBe('unavailable');
  });
});
