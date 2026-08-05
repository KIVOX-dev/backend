const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression tests for H-7: profile.routes.js's upload.any() used to accept
// any file with no MIME/extension/content check at all.
describe('Upload security: /profile', () => {
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

  // /profile is the staff onboarding endpoint (hr/institution_admin/faculty
  // — see onboardingSchemas.js#ROLE_TO_PORTAL); students use a separate,
  // non-multipart /students/profile endpoint. hr is used here purely as a
  // role that's allowed to reach this route at all.
  async function loginAsHr() {
    const institution = await seedInstitution(institutionRepository);
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'hr',
      institutionId: institution.id,
      email: `upload-${Date.now()}@example.com`,
    });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    return res.body.data.accessToken;
  }

  // A real 1x1 PNG's magic bytes.
  const REAL_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

  it('rejects a file whose extension/mimetype is not on the image allow-list', async () => {
    const token = await loginAsHr();
    await request(app)
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .attach('profilePhoto', Buffer.from('#!/bin/sh\necho pwned'), { filename: 'shell.sh', contentType: 'application/x-sh' })
      .expect(400);
  });

  it('rejects a file with a disguised double extension claiming to be an image', async () => {
    const token = await loginAsHr();
    await request(app)
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .attach('profilePhoto', Buffer.from('<?php system($_GET["c"]); ?>'), {
        filename: 'avatar.jpg.php',
        contentType: 'image/jpeg',
      })
      .expect(400);
  });

  it('rejects content whose magic bytes do not match its claimed image MIME type', async () => {
    const token = await loginAsHr();
    // Declares image/png + a .png filename, but the actual bytes are plain
    // text — this is exactly what a renamed executable/script looks like to
    // a check that only trusts the extension or Content-Type header.
    await request(app)
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .attach('profilePhoto', Buffer.from('not actually a png'), { filename: 'fake.png', contentType: 'image/png' })
      .expect(400);
  });

  it('accepts a real PNG', async () => {
    const token = await loginAsHr();
    const res = await request(app)
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .attach('profilePhoto', REAL_PNG, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(200);
    expect(res.body.data.values.profilePhoto).toMatch(/^\/uploads\/profile\/.+\.png$/);
  });

  it('rejects an oversized file', async () => {
    const token = await loginAsHr();
    const oversized = Buffer.concat([REAL_PNG, Buffer.alloc(6 * 1024 * 1024)]);
    await request(app)
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .attach('profilePhoto', oversized, { filename: 'huge.png', contentType: 'image/png' })
      .expect(400);
  });
});
