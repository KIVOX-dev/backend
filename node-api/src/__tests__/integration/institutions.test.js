const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

describe('Institutions: CRUD, RBAC, public listing', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let hashPassword;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, hashPassword } = await buildTestApp());
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function login(email, password) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.data.accessToken;
  }

  it('GET /institutions/public works with no auth and only returns active institutions', async () => {
    await seedInstitution(institutionRepository, { name: 'Active Institute', code: `ACT-${Date.now()}`, is_active: true });
    await seedInstitution(institutionRepository, { name: 'Inactive Institute', code: `INA-${Date.now()}`, is_active: false });

    const res = await request(app).get('/api/v1/institutions/public').expect(200);
    const names = res.body.data.map((i) => i.name);
    expect(names).toContain('Active Institute');
    expect(names).not.toContain('Inactive Institute');
  });

  it('GET /institutions requires authentication', async () => {
    await request(app).get('/api/v1/institutions').expect(401);
  });

  it('GET /institutions is forbidden for student/faculty roles', async () => {
    const institution = await seedInstitution(institutionRepository);
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `student-${Date.now()}@example.com`,
    });
    const token = await login(user.email, password);
    await request(app).get('/api/v1/institutions').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('only super_admin can create/update/delete an institution', async () => {
    const institution = await seedInstitution(institutionRepository);
    const { user: admin, password: adminPassword } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `inst-admin-${Date.now()}@example.com`,
    });
    const adminToken = await login(admin.email, adminPassword);

    await request(app)
      .post('/api/v1/institutions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Should Fail', code: `SF-${Date.now()}` })
      .expect(403);

    const { user: superAdmin, password: superPassword } = await seedUser(userRepository, hashPassword, {
      role: 'super_admin',
      email: `super-${Date.now()}@example.com`,
    });
    const superToken = await login(superAdmin.email, superPassword);

    const createRes = await request(app)
      .post('/api/v1/institutions')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: 'New Institute', code: `NI-${Date.now()}` })
      .expect(201);
    const newId = createRes.body.data.id;

    await request(app)
      .put(`/api/v1/institutions/${newId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Hijacked' })
      .expect(403);

    await request(app)
      .put(`/api/v1/institutions/${newId}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: 'Renamed Institute' })
      .expect(200);

    await request(app).delete(`/api/v1/institutions/${newId}`).set('Authorization', `Bearer ${adminToken}`).expect(403);
    await request(app).delete(`/api/v1/institutions/${newId}`).set('Authorization', `Bearer ${superToken}`).expect(200);
    await request(app).get(`/api/v1/institutions/${newId}`).set('Authorization', `Bearer ${superToken}`).expect(404);
  });

  it('rejects institution creation with missing required fields', async () => {
    const { user: superAdmin, password } = await seedUser(userRepository, hashPassword, {
      role: 'super_admin',
      email: `super-val-${Date.now()}@example.com`,
    });
    const token = await login(superAdmin.email, password);
    await request(app).post('/api/v1/institutions').set('Authorization', `Bearer ${token}`).send({ name: 'No Code' }).expect(400);
  });

  it('GET /institutions/:id returns 404 for a nonexistent id', async () => {
    const { user: superAdmin, password } = await seedUser(userRepository, hashPassword, {
      role: 'super_admin',
      email: `super-404-${Date.now()}@example.com`,
    });
    const token = await login(superAdmin.email, password);
    await request(app)
      .get('/api/v1/institutions/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
