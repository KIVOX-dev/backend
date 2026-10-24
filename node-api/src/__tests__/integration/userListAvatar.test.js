const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// The Manage Users table shows each student's profile photo. That photo is
// uploaded to the students row (students.avatar_url), not to the user, so the
// users list has to carry it across — see user.service.js#list.
describe('GET /users — student profile photo', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let studentRepository;
  let hashPassword;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, studentRepository, hashPassword } = await buildTestApp());
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  it("returns each student's own uploaded photo, and null for one without", async () => {
    const institution = await seedInstitution(institutionRepository, { code: `AV-${Date.now()}` });
    const { user: admin, password } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `av-admin-${Date.now()}@example.com`,
    });
    const login = await request(app).post('/api/v1/auth/login').send({ email: admin.email, password }).expect(200);
    const token = login.body.data.accessToken;

    const withPhoto = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `av-photo-${Date.now()}@example.com`,
    });
    await studentRepository.create({
      user_id: withPhoto.user.id,
      institution_id: institution.id,
      roll_number: 'AV-1',
      avatar_url: '/uploads/profile/kaviarasan-photo.png',
    });
    const withoutPhoto = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `av-none-${Date.now()}@example.com`,
    });
    await studentRepository.create({ user_id: withoutPhoto.user.id, institution_id: institution.id, roll_number: 'AV-2' });

    const res = await request(app).get('/api/v1/users/').set('Authorization', `Bearer ${token}`).expect(200);
    const rows = res.body.data.rows || res.body.data;
    const photoRow = rows.find((u) => u.id === withPhoto.user.id);
    const noneRow = rows.find((u) => u.id === withoutPhoto.user.id);

    expect(photoRow.avatar_url).toEqual(expect.stringContaining('kaviarasan-photo.png'));
    expect(noneRow.avatar_url).toBeNull();
  });
});
