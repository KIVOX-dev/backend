const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

describe('Departments: CRUD, RBAC, cross-tenant isolation', () => {
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

  async function loginAsAdmin(institutionId) {
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId,
      email: `dept-admin-${Date.now()}-${Math.random()}@example.com`,
    });
    return login(user.email, password);
  }

  it('institution_admin can create/update/delete a department in their own institution', async () => {
    const institution = await seedInstitution(institutionRepository);
    const token = await loginAsAdmin(institution.id);

    const createRes = await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${token}`)
      .send({ institution_id: institution.id, name: 'Computer Science', code: 'CS' })
      .expect(201);
    const deptId = createRes.body.data.id;

    await request(app)
      .put(`/api/v1/departments/${deptId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'CS & Engineering' })
      .expect(200);

    await request(app).delete(`/api/v1/departments/${deptId}`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get(`/api/v1/departments/${deptId}`).set('Authorization', `Bearer ${token}`).expect(404);
  });

  it('student/faculty cannot create, update, or delete departments', async () => {
    const institution = await seedInstitution(institutionRepository);
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'faculty',
      institutionId: institution.id,
      email: `faculty-${Date.now()}@example.com`,
    });
    const token = await login(user.email, password);

    await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${token}`)
      .send({ institution_id: institution.id, name: 'Should Fail', code: 'SF' })
      .expect(403);
  });

  it('scopeInstitution forces institution_id server-side, ignoring a spoofed value from a non-super_admin', async () => {
    const institutionA = await seedInstitution(institutionRepository, { code: `DA-${Date.now()}` });
    const institutionB = await seedInstitution(institutionRepository, { code: `DB-${Date.now()}` });
    const tokenA = await loginAsAdmin(institutionA.id);

    const res = await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ institution_id: institutionB.id, name: 'Spoofed Dept', code: 'SPOOF' })
      .expect(201);

    expect(res.body.data.institution_id).toBe(institutionA.id);
  });

  it('a department created in institution A is never visible when listing as institution B', async () => {
    const institutionA = await seedInstitution(institutionRepository, { code: `IA-${Date.now()}` });
    const institutionB = await seedInstitution(institutionRepository, { code: `IB-${Date.now()}` });
    const tokenA = await loginAsAdmin(institutionA.id);
    const tokenB = await loginAsAdmin(institutionB.id);

    await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ institution_id: institutionA.id, name: 'A-Only Department', code: `AO-${Date.now()}` })
      .expect(201);

    const listB = await request(app).get('/api/v1/departments').set('Authorization', `Bearer ${tokenB}`).expect(200);
    const names = listB.body.data.map((d) => d.name);
    expect(names).not.toContain('A-Only Department');
  });

  it('rejects department creation with a missing required field', async () => {
    const institution = await seedInstitution(institutionRepository);
    const token = await loginAsAdmin(institution.id);
    await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${token}`)
      .send({ institution_id: institution.id, name: 'No Code' })
      .expect(400);
  });
});
