// Unit tests for utils/privateMedia.js — the reference parser and the
// response-body signer. GCS signing is mocked; the real call needs cloud
// credentials (see docs/OPERATIONS.md, "Private profile photos").
jest.mock('../utils/gcsClient', () => ({
  uploadPrivateFile: jest.fn(),
  downloadFile: jest.fn(),
  signReadUrl: jest.fn(),
}));

const BUCKET = 'test-media-bucket';

function loadModule() {
  jest.resetModules();
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/unused';
  process.env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret';
  process.env.GCS_BUCKET_NAME = BUCKET;
  process.env.MEDIA_URL_TTL_SECONDS = '900';
  const privateMedia = require('../utils/privateMedia');
  const gcsClient = require('../utils/gcsClient');
  gcsClient.signReadUrl.mockImplementation(
    async ({ bucketName, destination, ttlSeconds }) => `https://signed.example/${bucketName}/${destination}?ttl=${ttlSeconds}`
  );
  return { privateMedia, gcsClient };
}

describe('privateMedia.parseRef', () => {
  let privateMedia;
  beforeEach(() => {
    ({ privateMedia } = loadModule());
  });

  it('parses a gs:// reference in the media bucket', () => {
    expect(privateMedia.parseRef(`gs://${BUCKET}/student-profile/abc-123.png`)).toEqual({
      kind: 'gcs',
      bucket: BUCKET,
      objectPath: 'student-profile/abc-123.png',
    });
  });

  it('parses a legacy public storage.googleapis.com URL, ignoring any query string', () => {
    expect(privateMedia.parseRef(`https://storage.googleapis.com/${BUCKET}/profile/abc.jpg?x=1`)).toEqual({
      kind: 'gcs',
      bucket: BUCKET,
      objectPath: 'profile/abc.jpg',
    });
  });

  it('parses a local /uploads/profile path', () => {
    expect(privateMedia.parseRef('/uploads/profile/abc-123.png')).toEqual({ kind: 'local', filename: 'abc-123.png' });
  });

  it.each([
    ['another bucket', 'gs://someone-elses-bucket/student-profile/a.png'],
    ['a non-media prefix in the same bucket (offer letters)', `gs://${BUCKET}/placement-proof/inst/a.pdf`],
    ['path traversal', `gs://${BUCKET}/student-profile/../placement-proof/a.pdf`],
    ['a nested path under a media prefix', `gs://${BUCKET}/student-profile/x/a.png`],
    ['local path traversal', '/uploads/profile/../placement-proof/a.pdf'],
    ['an external avatar URL', 'https://avatars.githubusercontent.com/u/1?v=4'],
    ['a non-string', 42],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(privateMedia.parseRef(value)).toBeNull();
  });
});

describe('privateMedia.signMediaInBody', () => {
  let privateMedia;
  let gcsClient;
  beforeEach(() => {
    ({ privateMedia, gcsClient } = loadModule());
  });

  it('returns the exact same body when it has no media references', async () => {
    const body = { success: true, data: [{ name: 'a', avatar_url: 'https://avatars.githubusercontent.com/u/1' }] };
    await expect(privateMedia.signMediaInBody(body)).resolves.toBe(body);
    expect(gcsClient.signReadUrl).not.toHaveBeenCalled();
  });

  it('signs nested references without mutating the original', async () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const student = {
      id: 's1',
      created_at: created,
      avatar_url: `gs://${BUCKET}/student-profile/a.png`,
      cover_image_url: `https://storage.googleapis.com/${BUCKET}/student-profile/b.png`,
      github_avatar_url: 'https://avatars.githubusercontent.com/u/1',
    };
    const body = { success: true, data: { rows: [student], profile: { values: { signature: '/uploads/profile/c.png' } } } };

    const signed = await privateMedia.signMediaInBody(body);

    expect(signed.data.rows[0].avatar_url).toBe(`https://signed.example/${BUCKET}/student-profile/a.png?ttl=900`);
    expect(signed.data.rows[0].cover_image_url).toBe(`https://signed.example/${BUCKET}/student-profile/b.png?ttl=900`);
    expect(signed.data.rows[0].github_avatar_url).toBe('https://avatars.githubusercontent.com/u/1');
    expect(signed.data.rows[0].created_at).toBe(created);
    expect(signed.data.profile.values.signature).toMatch(/^\/uploads\/profile\/c\.png\?token=[\w-]+&exp=\d+$/);

    // Original untouched (it may be cached elsewhere).
    expect(student.avatar_url).toBe(`gs://${BUCKET}/student-profile/a.png`);
    expect(body.data.profile.values.signature).toBe('/uploads/profile/c.png');
  });

  it('only rewrites known media keys', async () => {
    const body = { description: `gs://${BUCKET}/student-profile/a.png` };
    await expect(privateMedia.signMediaInBody(body)).resolves.toBe(body);
  });

  it('reuses a cached signed URL instead of re-signing on every response', async () => {
    const body = { avatar_url: `gs://${BUCKET}/student-profile/a.png` };
    await privateMedia.signMediaInBody(body);
    await privateMedia.signMediaInBody(body);
    expect(gcsClient.signReadUrl).toHaveBeenCalledTimes(1);
  });

  it('returns null for an image whose signing fails, never the raw reference', async () => {
    gcsClient.signReadUrl.mockRejectedValueOnce(new Error('signBlob denied'));
    const signed = await privateMedia.signMediaInBody({ avatar_url: `gs://${BUCKET}/student-profile/z.png` });
    expect(signed.avatar_url).toBeNull();
  });
});
