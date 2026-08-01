const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression tests for H-2: BaseService.list/ApiResponse.paginated used to
// report page/limit/total/totalPages with no hasNext/hasPrevious and no
// sort support.
describe('Pagination: GET /institutions', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let hashPassword;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, hashPassword } = await buildTestApp());

    for (let i = 0; i < 25; i += 1) {
      await seedInstitution(institutionRepository, { name: `Institute ${String(i).padStart(2, '0')}`, code: `INST-${i}-${Date.now()}` });
    }
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function loginAsSuperAdmin() {
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'super_admin',
      email: `super-${Date.now()}-${Math.random()}@example.com`,
    });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    return res.body.data.accessToken;
  }

  it('returns real pagination metadata, not a silently truncated array', async () => {
    const token = await loginAsSuperAdmin();
    const res = await request(app)
      .get('/api/v1/institutions')
      .query({ page: 1, limit: 10 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.length).toBe(10);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 10 });
    expect(res.body.meta.total).toBeGreaterThanOrEqual(25);
    expect(res.body.meta.totalPages).toBeGreaterThanOrEqual(3);
    expect(res.body.meta.hasNext).toBe(true);
    expect(res.body.meta.hasPrevious).toBe(false);
  });

  it('hasPrevious is true and hasNext is false on the last page', async () => {
    const token = await loginAsSuperAdmin();
    const first = await request(app)
      .get('/api/v1/institutions')
      .query({ page: 1, limit: 10 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const lastPage = first.body.meta.totalPages;

    const res = await request(app)
      .get('/api/v1/institutions')
      .query({ page: lastPage, limit: 10 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.meta.hasNext).toBe(false);
    expect(res.body.meta.hasPrevious).toBe(true);
  });

  it('supports sortBy/sortOrder', async () => {
    const token = await loginAsSuperAdmin();
    const asc = await request(app)
      .get('/api/v1/institutions')
      .query({ page: 1, limit: 5, sortBy: 'name', sortOrder: 'asc' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const desc = await request(app)
      .get('/api/v1/institutions')
      .query({ page: 1, limit: 5, sortBy: 'name', sortOrder: 'desc' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(asc.body.data[0].name).not.toBe(desc.body.data[0].name);
  });

  it('ignores an unrecognized sortBy rather than erroring', async () => {
    const token = await loginAsSuperAdmin();
    await request(app)
      .get('/api/v1/institutions')
      .query({ page: 1, limit: 5, sortBy: '$where' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
