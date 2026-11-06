const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// /tts: students only, voices chosen server-side by slot, responses cached so repeated lines
// (greeting, closing) cost one Google call. Google is mocked; no network or GCS is touched.
describe('POST /tts', () => {
  let app;
  let database;
  let env;
  let studentToken;
  let adminToken;
  let fetchSpy;
  const audio = Buffer.from('fake-mp3-bytes');

  beforeAll(async () => {
    process.env.GCP_TTS_API_KEY = 'test-tts-key';
    const built = await buildTestApp();
    ({ app, database } = built);
    env = require('../../config/env');
    env.tts.cacheBucket = ''; // memory cache only; never touch a real bucket in tests
    const inst = await seedInstitution(built.institutionRepository, { code: `TTS-${Date.now()}` });
    const login = async (role) => {
      const { user, password } = await seedUser(built.userRepository, built.hashPassword, {
        role, institutionId: inst.id, email: `${role}-tts-${Date.now()}@example.com`,
      });
      const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
      return res.body.data.accessToken;
    };
    studentToken = await login('student');
    adminToken = await login('institution_admin');
  });

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ audioContent: audio.toString('base64') }),
    });
  });
  afterEach(() => fetchSpy.mockRestore());
  afterAll(async () => {
    await teardownTestApp(database);
  });

  const post = (token, body) => request(app).post('/api/v1/tts').set('Authorization', `Bearer ${token}`).send(body);

  it('returns audio and serves a repeated line from cache (one Google call)', async () => {
    const body = { voice: 'interviewer', text: 'Hello, welcome to your interview.' };
    const a = await post(studentToken, body).expect(200);
    expect(a.headers['content-type']).toMatch(/audio\/mpeg/);
    await post(studentToken, body).expect(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('uses SSML + pitch for WaveNet bots and plain text without pitch for the Chirp interviewer', async () => {
    await post(studentToken, { voice: 'bot2', text: 'First point. Second point.' }).expect(200);
    const bot = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(bot.voice.name).toBe('en-IN-Wavenet-C');
    expect(bot.input.ssml).toBe('<speak>First point.<break time="250ms"/>Second point.</speak>');
    expect(bot.audioConfig.pitch).toBe(2);
    expect(bot.audioConfig.speakingRate).toBe(0.92);
    // API key travels in a header, never in the URL.
    expect(fetchSpy.mock.calls[0][0]).not.toMatch(/key=/);

    await post(studentToken, { voice: 'interviewer', text: 'A different closing line.' }).expect(200);
    const hr = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(hr.voice.name).toBe('en-IN-Chirp3-HD-Aoede');
    expect(hr.input.text).toBeDefined();
    expect(hr.audioConfig.pitch).toBeUndefined();
  });

  it('rejects unknown voices, over-long text, non-students and anonymous callers', async () => {
    await post(studentToken, { voice: 'en-IN-Wavenet-F', text: 'hi' }).expect(400);
    await post(studentToken, { voice: 'bot0', text: 'x'.repeat(301) }).expect(400);
    await post(adminToken, { voice: 'bot0', text: 'hi' }).expect(403);
    await request(app).post('/api/v1/tts').send({ voice: 'bot0', text: 'hi' }).expect(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 503 when Google fails, so the UI can fall back to browser voices', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await post(studentToken, { voice: 'bot1', text: 'Uncached failing line.' }).expect(503);
  });
});
