const request = require('supertest');
const sharp = require('sharp');
const crypto = require('crypto');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// GCS is never called: the client module is replaced and its calls inspected.
const mockUploadPublicFile = jest.fn();
const mockDeleteFile = jest.fn();
jest.mock('../../utils/gcsClient', () => ({
  uploadPublicFile: (...args) => mockUploadPublicFile(...args),
  uploadPrivateFile: jest.fn(),
  deleteFile: (...args) => mockDeleteFile(...args),
  signReadUrl: jest.fn(),
  downloadFile: jest.fn(),
}));

const BUCKET = 'test-public-logos';

describe('company logo → public logo bucket', () => {
  let app;
  let database;
  let token;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const upload = (buf, opts = { filename: 'logo.png', contentType: 'image/png' }) =>
    request(app).post('/api/v1/jobs/logo').set(auth()).attach('logo', buf, opts);
  const png = (width, height) =>
    sharp({ create: { width, height, channels: 3, background: '#3b4cf0' } }).png().toBuffer();

  beforeAll(async () => {
    process.env.GCS_PUBLIC_LOGO_BUCKET = BUCKET;
    const ctx = await buildTestApp();
    ({ app, database } = ctx);
    const institution = await seedInstitution(ctx.institutionRepository);
    const { user, password } = await seedUser(ctx.userRepository, ctx.hashPassword, {
      role: 'hr', institutionId: institution.id, email: `logo-hr-${Date.now()}@example.com`,
    });
    token = (await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200)).body.data.accessToken;
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  beforeEach(() => {
    mockUploadPublicFile.mockReset();
    mockDeleteFile.mockReset();
    mockUploadPublicFile.mockImplementation(async (buffer, { bucketName, destination }) => `https://storage.googleapis.com/${bucketName}/${destination}`);
  });

  it('resizes a large logo to fit 400x160 as a PNG and stores its public URL', async () => {
    const res = await upload(await png(1200, 600)).expect(200);
    expect(res.body.data.logo_ref).toMatch(new RegExp(`^https://storage\\.googleapis\\.com/${BUCKET}/company-logo/[\\w-]+\\.png$`));

    const [buffer, options] = mockUploadPublicFile.mock.calls[0];
    expect(options).toMatchObject({ bucketName: BUCKET, contentType: 'image/png' });
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBeLessThanOrEqual(400);
    expect(meta.height).toBeLessThanOrEqual(160);
    expect(meta.width / meta.height).toBeCloseTo(2, 1); // aspect ratio kept
  });

  it('never enlarges a small logo, and converts a JPEG to PNG', async () => {
    const jpeg = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    await upload(jpeg, { filename: 'logo.jpg', contentType: 'image/jpeg' }).expect(200);
    const meta = await sharp(mockUploadPublicFile.mock.calls[0][0]).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 100, height: 50 });
  });

  it('rejects a logo over 2 MB and a file that is not really an image', async () => {
    const noise = await sharp(crypto.randomBytes(900 * 900 * 3), { raw: { width: 900, height: 900, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
    expect(noise.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(noise.length).toBeLessThan(5 * 1024 * 1024);
    const big = await upload(noise).expect(400);
    expect(big.body.message).toMatch(/2 MB/);

    // Valid PNG signature, garbage body — sharp can't decode it.
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage')]);
    await upload(fake).expect(400);
    expect(mockUploadPublicFile).not.toHaveBeenCalled();
  });

  it('keeps the public URL on the drive unchanged (not signed), accepts only our own URLs, and deletes a replaced logo', async () => {
    const { logo_ref: first } = (await upload(await png(300, 100)).expect(200)).body.data;
    const created = await request(app).post('/api/v1/jobs').set(auth())
      .send({ title: 'Designer', status: 'open', company_name: 'Acme', company_logo_url: first }).expect(201);
    expect(created.body.data.company_logo_url).toBe(first);

    await request(app).post('/api/v1/jobs').set(auth())
      .send({ title: 'X', company_logo_url: `https://storage.googleapis.com/other-bucket/company-logo/x.png` }).expect(400);

    const { logo_ref: second } = (await upload(await png(300, 100)).expect(200)).body.data;
    await request(app).put(`/api/v1/jobs/${created.body.data.id}`).set(auth()).send({ company_logo_url: second }).expect(200);
    expect(mockDeleteFile).toHaveBeenCalledWith({ bucketName: BUCKET, destination: first.slice(`https://storage.googleapis.com/${BUCKET}/`.length) });
  });
});
