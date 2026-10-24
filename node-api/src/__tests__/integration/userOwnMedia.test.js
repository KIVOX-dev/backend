const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Staff accounts (institution admin, faculty, HR, super admin) set their own
// profile photo and banner through POST /users/me/avatar|cover — students keep
// using /students/profile/avatar|cover. user.service.js#setOwnMedia is what
// persists the stored reference.
describe('own profile photo / banner for staff accounts', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let hashPassword;
  let userService;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, hashPassword } = await buildTestApp());
    userService = require('../../services/user.service');
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function loginAs(role) {
    const institution = await seedInstitution(institutionRepository, { code: `OM-${role}-${Date.now()}` });
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role,
      institutionId: institution.id,
      email: `om-${role}-${Date.now()}@example.com`,
    });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    return { user, token: res.body.data.accessToken };
  }

  it('stores the avatar and cover references on the caller\'s own user row only', async () => {
    const { user } = await loginAs('institution_admin');
    const other = await loginAs('faculty');

    const withAvatar = await userService.setOwnMedia(user, 'avatar_url', 'gs://bucket/student-profile/a.png');
    expect(withAvatar.avatar_url).toBe('gs://bucket/student-profile/a.png');
    expect(withAvatar.password_hash).toBeUndefined();
    const withCover = await userService.setOwnMedia(user, 'cover_image_url', 'gs://bucket/student-profile/c.png');
    expect(withCover.cover_image_url).toBe('gs://bucket/student-profile/c.png');
    expect(withCover.avatar_url).toBe('gs://bucket/student-profile/a.png');

    const untouched = await userRepository.findById(other.user.id);
    expect(untouched.avatar_url ?? null).toBeNull();
  });

  it('refuses any field other than the two image fields, and a missing image', async () => {
    const { user } = await loginAs('institution_admin');
    await expect(userService.setOwnMedia(user, 'role', 'super_admin')).rejects.toThrow(/Unsupported image field/);
    await expect(userService.setOwnMedia(user, 'avatar_url', undefined)).rejects.toThrow(/No image uploaded/);
  });

  it('rejects unauthenticated callers and students on the staff upload routes', async () => {
    await request(app).post('/api/v1/users/me/avatar').expect(401);
    const student = await loginAs('student');
    await request(app).post('/api/v1/users/me/avatar').set('Authorization', `Bearer ${student.token}`).expect(403);
    await request(app).post('/api/v1/users/me/cover').set('Authorization', `Bearer ${student.token}`).expect(403);
  });
});
