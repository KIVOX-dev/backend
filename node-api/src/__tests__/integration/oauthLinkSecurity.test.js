const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedUser } = require('../helpers/seed');

// GitHub itself is never called: the token exchange and profile fetch are
// stubbed, and the tests assert when they are (and aren't) reached.
jest.mock('../../utils/githubClient', () => {
  class GitHubOAuthError extends Error {}
  return {
    GitHubOAuthError,
    exchangeCodeForToken: jest.fn().mockResolvedValue('gh-access-token'),
    fetchGitHubUser: jest.fn().mockResolvedValue({ id: '4242', username: 'victim-gh', avatarUrl: null }),
    fetchContributionCalendar: jest.fn(),
  };
});

describe('OAuth account linking is tied to the signed-in student', () => {
  let app;
  let database;
  let userRepository;
  let studentRepository;
  let hashPassword;
  let signState;
  let githubClient;

  beforeAll(async () => {
    process.env.GITHUB_CLIENT_ID = 'test-gh-client';
    process.env.GITHUB_CLIENT_SECRET = 'test-gh-secret';
    process.env.GITHUB_CALLBACK_URL = 'http://localhost:5000/api/v1/auth/github/callback';
    ({ app, database } = await buildTestApp());
    userRepository = require('../../repositories/user.repository');
    studentRepository = require('../../repositories/student.repository');
    ({ hashPassword } = require('../../utils/password'));
    ({ signState } = require('../../utils/oauthState'));
    githubClient = require('../../utils/githubClient');
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  beforeEach(() => jest.clearAllMocks());

  async function student() {
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      email: `oauth-${Date.now()}-${Math.random()}@example.com`,
    });
    await studentRepository.create({ user_id: user.id });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    return { user, token: res.body.data.accessToken };
  }

  it('callback hands code/state back to the app without linking anything', async () => {
    const { user } = await student();
    const state = signState(user.id, 'github');

    const res = await request(app).get('/api/v1/auth/github/callback').query({ code: 'the-code', state }).expect(302);

    const location = new URL(res.headers.location);
    expect(location.searchParams.get('github')).toBe('confirm');
    expect(location.searchParams.get('code')).toBe('the-code');
    expect(location.searchParams.get('state')).toBe(state);
    expect(githubClient.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it("refuses to confirm a state minted for a different student (the attacker's link)", async () => {
    const attacker = await student();
    const victim = await student();
    const attackerState = signState(attacker.user.id, 'github');

    const res = await request(app)
      .post('/api/v1/auth/github/confirm')
      .set('Authorization', `Bearer ${victim.token}`)
      .send({ code: 'victims-code', state: attackerState })
      .expect(200);

    expect(res.body.data.status).toBe('wrong_account');
    expect(githubClient.exchangeCodeForToken).not.toHaveBeenCalled();
    const attackerProfile = await studentRepository.findByUserId(attacker.user.id);
    expect(attackerProfile.github_id).toBeFalsy();
  });

  it("links when the state belongs to the signed-in student, sending GitHub the PKCE verifier", async () => {
    const { user, token } = await student();
    const state = signState(user.id, 'github');

    const res = await request(app)
      .post('/api/v1/auth/github/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'own-code', state })
      .expect(200);

    expect(res.body.data.status).toBe('connected');
    expect(githubClient.exchangeCodeForToken).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'own-code', codeVerifier: expect.any(String) })
    );
    const profile = await studentRepository.findByUserId(user.id);
    expect(profile.github_username).toBe('victim-gh');
  });

  it('rejects confirm without a session', async () => {
    const { user } = await student();
    await request(app)
      .post('/api/v1/auth/github/confirm')
      .send({ code: 'c', state: signState(user.id, 'github') })
      .expect(401);
  });

  // V9: a state token is signed with JWT_SECRET too, but must not work as a
  // user's access token.
  it('does not accept an OAuth state token as a Bearer access token', async () => {
    const { user } = await student();
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${signState(user.id, 'github')}`)
      .expect(401);
  });
});
