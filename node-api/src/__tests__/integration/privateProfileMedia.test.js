const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Student avatar/cover images are private GCS objects: the database stores a
// gs:// reference and every response carries a short-lived signed URL
// instead (utils/privateMedia.js, middlewares/signPrivateMedia.js). GCS is
// mocked — real signing needs cloud credentials.
jest.mock('../../utils/gcsClient', () => ({
  uploadPrivateFile: jest.fn().mockResolvedValue(undefined),
  downloadFile: jest.fn().mockResolvedValue(null),
  signReadUrl: jest.fn(async ({ bucketName, destination }) => `https://signed.example/${bucketName}/${destination}?sig=1`),
}));

const BUCKET = 'test-private-media';
const REAL_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('Private profile media', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let studentRepository;
  let hashPassword;
  let gcsClient;

  beforeAll(async () => {
    process.env.GCS_BUCKET_NAME = BUCKET;
    ({ app, database, institutionRepository, userRepository, studentRepository, hashPassword } = await buildTestApp());
    // Same module registry the app was built from (buildTestApp resets it).
    gcsClient = require('../../utils/gcsClient');
  });

  afterAll(async () => {
    delete process.env.GCS_BUCKET_NAME;
    await teardownTestApp(database);
  });

  async function loginAsStudent() {
    const institution = await seedInstitution(institutionRepository);
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `media-${Date.now()}-${Math.random()}@example.com`,
    });
    const student = await studentRepository.create({ user_id: user.id, institution_id: institution.id });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    return { token: res.body.data.accessToken, user, student };
  }

  it('stores an uploaded avatar privately and returns only a signed URL', async () => {
    const { token, student } = await loginAsStudent();

    const res = await request(app)
      .post('/api/v1/students/profile/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', REAL_PNG, { filename: 'me.png', contentType: 'image/png' })
      .expect(200);

    const stored = await studentRepository.findById(student.id);
    expect(stored.avatar_url).toMatch(new RegExp(`^gs://${BUCKET}/student-profile/[0-9a-f-]+\\.png$`));
    expect(res.body.data.avatar_url).toBe(`https://signed.example/${stored.avatar_url.slice('gs://'.length)}?sig=1`);

    expect(gcsClient.uploadPrivateFile).toHaveBeenCalledWith(
      REAL_PNG,
      expect.objectContaining({ bucketName: BUCKET, contentType: 'image/png', cacheControl: expect.stringMatching(/^private/) })
    );
  });

  it('signs a legacy public-bucket URL already stored in the database', async () => {
    const { token, student } = await loginAsStudent();
    const legacy = `https://storage.googleapis.com/${BUCKET}/student-profile/0b6c1e9e-legacy.jpg`;
    await studentRepository.updateById(student.id, { cover_image_url: legacy });

    const res = await request(app).get('/api/v1/students/profile').set('Authorization', `Bearer ${token}`).expect(200);

    expect(res.body.data.cover_image_url).toBe(`https://signed.example/${BUCKET}/student-profile/0b6c1e9e-legacy.jpg?sig=1`);
  });

  it.each([
    ['a gs:// reference', `gs://${BUCKET}/profile/someone-else.png`],
    ['a URL into the private media bucket', `https://storage.googleapis.com/${BUCKET}/profile/someone-else.png`],
  ])('rejects %s as a user avatar_url', async (_label, avatarUrl) => {
    const { token, user } = await loginAsStudent();
    await request(app)
      .put(`/api/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar_url: avatarUrl })
      .expect(400);
  });
});
