const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression test: college-admin listing used the raw BaseService.list()
// with no institution scoping at all — GET /college-admins silently
// returned every institution's rows to any authenticated institution_admin.
// Surfaced by the Express 5 migration (req.query mutation, previously used
// elsewhere for this kind of scoping, silently stopped working), but this
// entity was never scoped via req.query to begin with — it just had no
// scoping whatsoever, in any Express version.
describe('College Admins: institution-scoped listing', () => {
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

  it('never leaks another institution\'s college-admin rows into the list', async () => {
    const institutionA = await seedInstitution(institutionRepository, { code: `CAA-${Date.now()}` });
    const institutionB = await seedInstitution(institutionRepository, { code: `CAB-${Date.now()}` });

    const { user: superAdmin, password: superPassword } = await seedUser(userRepository, hashPassword, {
      role: 'super_admin',
      email: `super-ca-${Date.now()}@example.com`,
    });
    const superToken = await login(superAdmin.email, superPassword);

    const { user: adminAUser } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institutionA.id,
      email: `ca-user-a-${Date.now()}@example.com`,
    });
    const { user: adminBUser } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institutionB.id,
      email: `ca-user-b-${Date.now()}@example.com`,
    });

    await request(app)
      .post('/api/v1/college-admins')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ user_id: adminAUser.id, institution_id: institutionA.id, designation: 'Registrar A' })
      .expect(201);
    await request(app)
      .post('/api/v1/college-admins')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ user_id: adminBUser.id, institution_id: institutionB.id, designation: 'Registrar B' })
      .expect(201);

    const { user: viewerAdminA, password: viewerPassword } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institutionA.id,
      email: `ca-viewer-${Date.now()}@example.com`,
    });
    const viewerToken = await login(viewerAdminA.email, viewerPassword);

    const res = await request(app).get('/api/v1/college-admins').set('Authorization', `Bearer ${viewerToken}`).expect(200);
    const designations = res.body.data.map((r) => r.designation);
    expect(designations).toContain('Registrar A');
    expect(designations).not.toContain('Registrar B');
  });

  it('super_admin sees college-admins across every institution', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `CAS-${Date.now()}` });
    const { user: superAdmin, password } = await seedUser(userRepository, hashPassword, {
      role: 'super_admin',
      email: `super-ca2-${Date.now()}@example.com`,
    });
    const token = await login(superAdmin.email, password);

    const { user: targetUser } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `ca-target-${Date.now()}@example.com`,
    });
    await request(app)
      .post('/api/v1/college-admins')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: targetUser.id, institution_id: institution.id, designation: 'Cross-visible Registrar' })
      .expect(201);

    const res = await request(app).get('/api/v1/college-admins').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.data.map((r) => r.designation)).toContain('Cross-visible Registrar');
  });
});
