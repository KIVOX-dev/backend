const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// 1x1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('Vacancy company logo', () => {
  let app;
  let database;
  let hrToken;
  let otherHrToken;
  let studentToken;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const upload = (t, buf = PNG, opts = { filename: 'logo.png', contentType: 'image/png' }) =>
    request(app).post('/api/v1/jobs/logo').set(auth(t)).attach('logo', buf, opts);

  beforeAll(async () => {
    const ctx = await buildTestApp();
    ({ app, database } = ctx);
    const institution = await seedInstitution(ctx.institutionRepository);
    const mk = async (role, n) => {
      const { user, password } = await seedUser(ctx.userRepository, ctx.hashPassword, { role, institutionId: institution.id, email: `${n}-${Date.now()}@example.com` });
      return (await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200)).body.data.accessToken;
    };
    hrToken = await mk('hr', 'hr1');
    otherHrToken = await mk('hr', 'hr2');
    studentToken = await mk('student', 'stu');
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  it('uploads a logo and returns a reference plus a signed preview', async () => {
    const res = await upload(hrToken).expect(200);
    expect(res.body.data.logo_ref).toMatch(/^\/uploads\/profile\/logo-[\w-]+\.png$/);
    expect(res.body.data.preview_url).toMatch(/token=.*&exp=/);
    const img = await request(app).get(res.body.data.preview_url).expect(200);
    expect(img.headers['content-type']).toMatch(/png/);
  });

  it('rejects non-images, spoofed images, SVG and students', async () => {
    await upload(hrToken, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { filename: 'l.svg', contentType: 'image/svg+xml' }).expect(400);
    await upload(hrToken, Buffer.from('not really a png'), { filename: 'l.png', contentType: 'image/png' }).expect(400);
    await upload(studentToken).expect(403);
    await request(app).post('/api/v1/jobs/logo').expect(401);
  });

  it('attaches the logo to a vacancy and students see a signed URL, never the raw reference', async () => {
    const { logo_ref: ref } = (await upload(hrToken).expect(200)).body.data;
    const created = await request(app).post('/api/v1/jobs').set(auth(hrToken)).send({ title: 'Designer', status: 'open', company_name: 'Acme', company_logo_url: ref }).expect(201);
    expect(created.body.data.company_logo_url).toMatch(/token=/);
    expect(created.body.data.company_logo_url).not.toBe(ref);

    const list = await request(app).get('/api/v1/jobs').set(auth(studentToken)).expect(200);
    const row = list.body.data.find((p) => p.id === created.body.data.id);
    expect(row.company_logo_url).toMatch(/token=/);
    await request(app).get(row.company_logo_url).expect(200);
  });

  it('refuses logo references that were not produced by the upload endpoint', async () => {
    const bad = (company_logo_url) => request(app).post('/api/v1/jobs').set(auth(hrToken)).send({ title: 'Logo check', company_logo_url });
    expect((await bad('https://evil.example.com/pixel.png').expect(400)).body.code).toBe('INVALID_LOGO');
    await bad('/uploads/profile/someones-avatar.png').expect(400); // another user's profile photo, not a logo-
    await bad('gs://other-bucket/company-logo/x.png').expect(400);
  });

  it('deletes the old file when the logo is replaced or removed', async () => {
    const first = (await upload(hrToken).expect(200)).body.data.logo_ref;
    const job = (await request(app).post('/api/v1/jobs').set(auth(hrToken)).send({ title: 'Replace me', company_logo_url: first }).expect(201)).body.data;
    const file = (ref) => path.join(process.cwd(), 'uploads', 'profile', ref.split('/').pop());
    expect(fs.existsSync(file(first))).toBe(true);

    const second = (await upload(hrToken).expect(200)).body.data.logo_ref;
    await request(app).put(`/api/v1/jobs/${job.id}`).set(auth(hrToken)).send({ company_logo_url: second }).expect(200);
    expect(fs.existsSync(file(first))).toBe(false);
    expect(fs.existsSync(file(second))).toBe(true);

    const cleared = await request(app).put(`/api/v1/jobs/${job.id}`).set(auth(hrToken)).send({ company_logo_url: null }).expect(200);
    expect(cleared.body.data.company_logo_url).toBeNull();
    expect(fs.existsSync(file(second))).toBe(false);
  });

  it('stops another recruiter editing a vacancy', async () => {
    const job = (await request(app).post('/api/v1/jobs').set(auth(hrToken)).send({ title: 'Mine' }).expect(201)).body.data;
    await request(app).put(`/api/v1/jobs/${job.id}`).set(auth(otherHrToken)).send({ title: 'Hijacked' }).expect(403);
    await request(app).put(`/api/v1/jobs/${job.id}`).set(auth(hrToken)).send({ title: 'Mine v2' }).expect(200);
  });
});
