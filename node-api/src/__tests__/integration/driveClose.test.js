const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// An institution admin can close a drive (PUT /placements/:id { status }) and
// reopen it. While it is closed, students can't apply; reopening lets them again.
describe('closing and reopening a placement drive', () => {
  let app;
  let database;
  let repos;
  let hashPassword;

  beforeAll(async () => {
    ({ app, database, hashPassword, ...repos } = await buildTestApp());
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function login(email, password) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return { Authorization: `Bearer ${res.body.data.accessToken}` };
  }

  it('blocks student applications while closed and allows them again once reopened', async () => {
    const institution = await seedInstitution(repos.institutionRepository, { code: `DC-${Date.now()}` });
    const admin = await seedUser(repos.userRepository, hashPassword, {
      role: 'institution_admin', institutionId: institution.id, email: `dc-admin-${Date.now()}@example.com`,
    });
    const adminAuth = await login(admin.user.email, admin.password);

    const studentUser = await seedUser(repos.userRepository, hashPassword, {
      role: 'student', institutionId: institution.id, email: `dc-student-${Date.now()}@example.com`,
    });
    await repos.studentRepository.create({ user_id: studentUser.user.id, institution_id: institution.id, roll_number: 'DC-1' });
    const studentAuth = await login(studentUser.user.email, studentUser.password);

    const placementRepository = require('../../repositories/placement.repository');
    const drive = await placementRepository.create({
      institution_id: institution.id, title: 'Campus Drive', company_name: 'TCS', status: 'open',
    });

    await request(app).put(`/api/v1/placements/${drive.id}`).set(adminAuth).send({ status: 'closed' }).expect(200);
    const blocked = await request(app).post('/api/v1/placement-applications').set(studentAuth).send({ placement_id: drive.id });
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(blocked.body)).toMatch(/closed/i);

    await request(app).put(`/api/v1/placements/${drive.id}`).set(adminAuth).send({ status: 'open' }).expect(200);
    await request(app).post('/api/v1/placement-applications').set(studentAuth).send({ placement_id: drive.id }).expect(201);
  });
});
