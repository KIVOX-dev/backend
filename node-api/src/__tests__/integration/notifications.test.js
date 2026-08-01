const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

describe('Notifications: personal inbox, RBAC, cross-tenant protection', () => {
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

  it('a student cannot create notifications for others', async () => {
    const institution = await seedInstitution(institutionRepository);
    const { user: student, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `student-${Date.now()}@example.com`,
    });
    const token = await login(student.email, password);

    await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: student.id, title: 'Hi', message: 'Test' })
      .expect(403);
  });

  it('institution_admin can notify a user in their own institution but not another', async () => {
    const institutionA = await seedInstitution(institutionRepository, { code: `NA-${Date.now()}` });
    const institutionB = await seedInstitution(institutionRepository, { code: `NB-${Date.now()}` });
    const { user: admin, password: adminPassword } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institutionA.id,
      email: `notif-admin-${Date.now()}@example.com`,
    });
    const { user: studentA } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institutionA.id,
      email: `student-a-${Date.now()}@example.com`,
    });
    const { user: studentB } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institutionB.id,
      email: `student-b-${Date.now()}@example.com`,
    });
    const token = await login(admin.email, adminPassword);

    await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: studentA.id, title: 'Welcome', message: 'Hello A' })
      .expect(201);

    await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: studentB.id, title: 'Cross tenant', message: 'Should fail' })
      .expect(403);
  });

  it('GET /notifications only ever returns the caller\'s own, and PATCH :id/read is owner-only', async () => {
    const institution = await seedInstitution(institutionRepository);
    const { user: admin, password: adminPassword } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `admin2-${Date.now()}@example.com`,
    });
    const { user: studentOne, password: studentOnePassword } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `s1-${Date.now()}@example.com`,
    });
    const { user: studentTwo, password: studentTwoPassword } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `s2-${Date.now()}@example.com`,
    });
    const adminToken = await login(admin.email, adminPassword);

    const createRes = await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: studentOne.id, title: 'For student one', message: 'msg' })
      .expect(201);
    const notificationId = createRes.body.data.id;

    const tokenOne = await login(studentOne.email, studentOnePassword);
    const tokenTwo = await login(studentTwo.email, studentTwoPassword);

    const listTwo = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${tokenTwo}`).expect(200);
    expect(listTwo.body.data.find((n) => n.id === notificationId)).toBeUndefined();

    const listOne = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${tokenOne}`).expect(200);
    expect(listOne.body.data.find((n) => n.id === notificationId)).toBeTruthy();

    await request(app)
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(403);

    await request(app)
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
  });

  it('rejects notification creation targeting a nonexistent user', async () => {
    const institution = await seedInstitution(institutionRepository);
    const { user: admin, password } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `admin3-${Date.now()}@example.com`,
    });
    const token = await login(admin.email, password);

    await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: '00000000-0000-0000-0000-000000000000', title: 'Ghost', message: 'msg' })
      .expect(400);
  });
});
