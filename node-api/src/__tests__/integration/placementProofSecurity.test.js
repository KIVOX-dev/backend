const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Regression tests for the P1 finding in PROJECT_AUDIT_REPORT.md:
// placement-proof documents (salary/employer detail PDFs) used to be served
// by a plain express.static('/uploads') mount with zero auth, protected
// only by an unguessable UUID filename. Fixed by removing placement-proof/
// from the static mount entirely and requiring a short-lived signed URL,
// minted only after the same ownership check every other per-record
// endpoint uses — see placementRecord.service.js#getProofUrl,
// routes/placementProofFiles.routes.js, and utils/signedUrl.js.
describe('Placement-proof documents: signed-URL access, not public static serving', () => {
  let app;
  let database;
  let institutionRepository;
  let userRepository;
  let studentRepository;
  let placementRecordRepository;
  let hashPassword;

  beforeAll(async () => {
    ({ app, database, institutionRepository, userRepository, studentRepository, placementRecordRepository, hashPassword } =
      await buildTestApp());
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  async function login(email, password) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.data.accessToken;
  }

  async function seedStudentWithRecord(institutionId, { proofFilename = 'offer.pdf' } = {}) {
    const { user, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId,
      email: `placement-${Date.now()}-${Math.random()}@example.com`,
    });
    const student = await studentRepository.create({ user_id: user.id, institution_id: institutionId });
    const record = await placementRecordRepository.create({
      student_id: student.id,
      institution_id: institutionId,
      company_name: 'Acme Corp',
      role: 'SDE',
      proof_url: `/uploads/placement-proof/${proofFilename}`,
    });
    return { user, password, student, record };
  }

  it('the old public static URL for a placement-proof document no longer works', async () => {
    await request(app).get('/uploads/placement-proof/some-file.pdf').expect(403);
  });

  it('rejects a proof-url request with no token/exp query params', async () => {
    await request(app).get('/uploads/placement-proof/some-file.pdf?token=x').expect(403);
  });

  it('blocks a student in another institution from minting a signed URL for someone else\'s record', async () => {
    const institutionA = await seedInstitution(institutionRepository, { code: `PPA-${Date.now()}` });
    const institutionB = await seedInstitution(institutionRepository, { code: `PPB-${Date.now()}` });
    const { record } = await seedStudentWithRecord(institutionA.id);
    const { user: outsider, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institutionB.id,
      email: `outsider-${Date.now()}@example.com`,
    });
    await studentRepository.create({ user_id: outsider.id, institution_id: institutionB.id });

    const token = await login(outsider.email, password);
    await request(app)
      .get(`/api/v1/placement-records/${record.id}/proof-url`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('blocks a different student in the SAME institution from minting a signed URL for a classmate\'s record', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `PPC-${Date.now()}` });
    const { record } = await seedStudentWithRecord(institution.id);
    const { user: classmate, password } = await seedUser(userRepository, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `classmate-${Date.now()}@example.com`,
    });
    await studentRepository.create({ user_id: classmate.id, institution_id: institution.id });

    const token = await login(classmate.email, password);
    await request(app)
      .get(`/api/v1/placement-records/${record.id}/proof-url`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('lets the owning student mint a signed URL and download the real file through it', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `PPD-${Date.now()}` });
    const { user, password, record } = await seedStudentWithRecord(institution.id, { proofFilename: 'real-download-test.pdf' });

    // Write the actual bytes the signed URL should serve.
    const fs = require('fs');
    const path = require('path');
    const { documentUploadDir } = require('../../middlewares/upload');
    fs.mkdirSync(documentUploadDir, { recursive: true });
    fs.writeFileSync(path.join(documentUploadDir, 'real-download-test.pdf'), '%PDF-1.4 test');

    const token = await login(user.email, password);
    const urlRes = await request(app)
      .get(`/api/v1/placement-records/${record.id}/proof-url`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(urlRes.body.data.url).toMatch(/^\/uploads\/placement-proof\/real-download-test\.pdf\?token=.+&exp=\d+$/);

    const fileRes = await request(app).get(urlRes.body.data.url).expect(200);
    expect(Buffer.from(fileRes.body).toString('utf8')).toBe('%PDF-1.4 test');
  });

  it('lets institution_admin staff in the same institution mint a signed URL', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `PPE-${Date.now()}` });
    const { record } = await seedStudentWithRecord(institution.id);
    const { user: admin, password } = await seedUser(userRepository, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `admin-${Date.now()}@example.com`,
    });

    const token = await login(admin.email, password);
    await request(app)
      .get(`/api/v1/placement-records/${record.id}/proof-url`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('rejects a tampered filename on an otherwise-valid signed URL', async () => {
    const institution = await seedInstitution(institutionRepository, { code: `PPF-${Date.now()}` });
    const { user, password, record } = await seedStudentWithRecord(institution.id, { proofFilename: 'original.pdf' });

    const token = await login(user.email, password);
    const urlRes = await request(app)
      .get(`/api/v1/placement-records/${record.id}/proof-url`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const tampered = urlRes.body.data.url.replace('original.pdf', 'someone-elses-file.pdf');
    await request(app).get(tampered).expect(403);
  });
});
