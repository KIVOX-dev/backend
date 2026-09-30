const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Higher-study admissions and competitive-exam results: a student reports
// their own, an admin verifies/deletes, and the NAAC / NBA / NIRF / list
// reports read the verified ones. Also the student's "attach an offer letter
// to an existing placement" action.
describe('Student outcomes (higher studies, competitive exams) and offer-letter uploads', () => {
  let app;
  let database;
  let repos;
  let hashPassword;
  let departmentRepository;

  beforeAll(async () => {
    const built = await buildTestApp();
    ({ app, database, hashPassword } = built);
    repos = built;
    departmentRepository = require('../../repositories/department.repository');
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  let counter = 0;
  const uniq = () => `${Date.now()}-${(counter += 1)}`;
  const PDF = Buffer.from('%PDF-1.4 test document');

  async function login(email, password) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return { Authorization: `Bearer ${res.body.data.accessToken}` };
  }

  async function setup() {
    const institution = await seedInstitution(repos.institutionRepository, { code: `OUT-${uniq()}` });
    const department = await departmentRepository.create({ institution_id: institution.id, name: 'Physics', code: 'PH' });
    const { user, password } = await seedUser(repos.userRepository, hashPassword, {
      role: 'institution_admin', institutionId: institution.id, email: `outcome-admin-${uniq()}@example.com`,
    });
    return { institution, department, admin: { user, auth: await login(user.email, password) } };
  }

  async function seedStudent({ institution, department }, { batchYear = 2026, placement } = {}) {
    const { user, password } = await seedUser(repos.userRepository, hashPassword, {
      role: 'student', institutionId: institution.id, email: `outcome-student-${uniq()}@example.com`, full_name: `Student ${uniq()}`,
    });
    const student = await repos.studentRepository.create({
      user_id: user.id, institution_id: institution.id, department_id: department.id, batch_year: batchYear, roll_number: `R${uniq()}`,
    });
    const record = placement
      ? await repos.placementRecordRepository.create({ student_id: student.id, institution_id: institution.id, company_name: 'Acme', role: 'SDE', ...placement })
      : null;
    return { user, student, record, auth: await login(user.email, password) };
  }

  it('a student reports their own higher study; it starts pending and is always filed under themselves', async () => {
    const ctx = await setup();
    const me = await seedStudent(ctx);
    const classmate = await seedStudent(ctx);

    const res = await request(app)
      .post('/api/v1/outcomes')
      .set(me.auth)
      .send({ type: 'higher_study', course: 'M.Sc Physics', institution_name: 'IISc', admission_year: 2026, student_id: classmate.student.id })
      .expect(201);

    expect(res.body.data).toMatchObject({ student_id: me.student.id, verification_status: 'pending', course: 'M.Sc Physics' });
    const mine = await request(app).get(`/api/v1/outcomes/student/${me.student.id}`).set(me.auth).expect(200);
    expect(mine.body.data).toHaveLength(1);
    // ...and a student can't read a classmate's list.
    await request(app).get(`/api/v1/outcomes/student/${classmate.student.id}`).set(me.auth).expect(403);
  });

  it('rejects malformed reports: missing fields, and fields that belong to the other type', async () => {
    const ctx = await setup();
    const me = await seedStudent(ctx);
    await request(app).post('/api/v1/outcomes').set(me.auth).send({ type: 'competitive_exam', exam_year: 2026 }).expect(400); // no exam
    await request(app).post('/api/v1/outcomes').set(me.auth).send({ type: 'higher_study', course: 'MSc' }).expect(400); // no institution
    await request(app).post('/api/v1/outcomes').set(me.auth).send({ type: 'higher_study', course: 'MSc', institution_name: 'X', exam: 'GATE' }).expect(400);
    await request(app).post('/api/v1/outcomes').set(me.auth).send({ type: 'competitive_exam', exam: 'NOPE', exam_year: 2026 }).expect(400);
  });

  it('a student cannot verify or delete, and another institution\'s admin cannot either', async () => {
    const ctx = await setup();
    const other = await setup();
    const me = await seedStudent(ctx);
    const created = await request(app)
      .post('/api/v1/outcomes').set(me.auth).send({ type: 'higher_study', course: 'MSc', institution_name: 'IISc' }).expect(201);
    const id = created.body.data.id;

    await request(app).put(`/api/v1/outcomes/${id}/verify`).set(me.auth).send({ verification_status: 'verified' }).expect(403);
    await request(app).delete(`/api/v1/outcomes/${id}`).set(me.auth).expect(403);
    await request(app).put(`/api/v1/outcomes/${id}/verify`).set(other.admin.auth).send({ verification_status: 'verified' }).expect(403);
    await request(app).delete(`/api/v1/outcomes/${id}`).set(other.admin.auth).expect(403);
    await request(app).get(`/api/v1/outcomes/${id}/proof-url`).set(other.admin.auth).expect(403);
  });

  it('uploads a proof, serves it only through a signed link, and lets an admin delete record + file', async () => {
    const ctx = await setup();
    const me = await seedStudent(ctx);
    const classmate = await seedStudent(ctx);

    const created = await request(app)
      .post('/api/v1/outcomes')
      .set(me.auth)
      .field('type', 'competitive_exam')
      .field('exam', 'GATE')
      .field('exam_year', '2026')
      .field('score', '612')
      .field('qualified', 'true')
      .attach('proof_file', PDF, { filename: 'scorecard.pdf', contentType: 'application/pdf' })
      .expect(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ exam: 'GATE', exam_year: 2026, qualified: true });

    await request(app).get(`/api/v1/outcomes/${id}/proof-url`).set(classmate.auth).expect(403);
    const signed = await request(app).get(`/api/v1/outcomes/${id}/proof-url`).set(me.auth).expect(200);
    expect(signed.body.data.url).toMatch(/^\/uploads\/outcome-proof\/.+\?token=.+&exp=\d+$/);

    const file = await request(app).get(signed.body.data.url).expect(200);
    expect(file.headers['content-type']).toMatch(/pdf/);
    await request(app).get(signed.body.data.url.split('?')[0]).expect(403); // no token

    await request(app).delete(`/api/v1/outcomes/${id}`).set(ctx.admin.auth).expect(200);
    await request(app).get(signed.body.data.url).expect(404); // file is gone too
  });

  it('a student attaches an offer letter to their own placement — unless it is already verified', async () => {
    const ctx = await setup();
    const me = await seedStudent(ctx, { placement: {} });
    const verified = await seedStudent(ctx, { placement: { verification_status: 'verified' } });
    const classmate = await seedStudent(ctx);
    const attach = (auth, recordId) =>
      request(app).put(`/api/v1/placement-records/${recordId}/proof`).set(auth).attach('proof_file', PDF, { filename: 'offer.pdf', contentType: 'application/pdf' });

    const ok = await attach(me.auth, me.record.id).expect(200);
    expect(ok.body.data.proof_url).toMatch(/^\/uploads\/placement-proof\/.+\.pdf$/);
    const signed = await request(app).get(`/api/v1/placement-records/${me.record.id}/proof-url`).set(me.auth).expect(200);
    await request(app).get(signed.body.data.url).expect(200);

    await attach(classmate.auth, me.record.id).expect(403); // someone else's placement
    await attach(verified.auth, verified.record.id).expect(403); // verified: can't swap the letter
    await attach(ctx.admin.auth, verified.record.id).expect(200); // staff can
    await request(app).put(`/api/v1/placement-records/${me.record.id}/proof`).set(me.auth).expect(400); // no file
  });

  it('reports: verified entries feed NAAC 5.2.2/5.2.3, NBA and NIRF; pending ones only show as awaiting verification', async () => {
    const ctx = await setup();
    const placed = await seedStudent(ctx, { placement: { verification_status: 'verified', salary_lpa: 8 } });
    const higher = await seedStudent(ctx);
    const both = await seedStudent(ctx, { placement: { verification_status: 'verified', salary_lpa: 6 } });
    await seedStudent(ctx); // nothing reported

    await request(app).post('/api/v1/outcomes').set(ctx.admin.auth)
      .send({ type: 'higher_study', student_id: higher.student.id, course: 'M.Tech', institution_name: 'IIT Madras' }).expect(201);
    await request(app).post('/api/v1/outcomes').set(ctx.admin.auth)
      .send({ type: 'higher_study', student_id: both.student.id, course: 'MBA', institution_name: 'IIM' }).expect(201);
    // A student's own report is pending until an admin verifies it.
    const pending = await request(app).post('/api/v1/outcomes').set(placed.auth)
      .send({ type: 'competitive_exam', exam: 'NET', exam_year: 2026, qualified: true }).expect(201);
    await request(app).post('/api/v1/outcomes').set(ctx.admin.auth)
      .send({ type: 'competitive_exam', student_id: higher.student.id, exam: 'GATE', exam_year: 2026, qualified: true }).expect(201);

    const get = (path) => request(app).get(`/api/v1/reports/${path}`).set(ctx.admin.auth).expect(200);

    const naac = (await get('naac?year=2026')).body.data;
    expect(naac.c521.summary[0]).toMatchObject({ year: 2026, outgoing: 4, count: 2, pct: 50 });
    expect(naac.c522.rows.map((r) => r.institution_joined).sort()).toEqual(['IIM', 'IIT Madras']);
    expect(naac.c523.rows.map((r) => r.exam)).toEqual(['GATE']); // the pending NET isn't counted yet
    expect(naac.completeness).toMatchObject({ missing_outcome: 1, pending_verification: 1 });

    await request(app).put(`/api/v1/outcomes/${pending.body.data.id}/verify`).set(ctx.admin.auth).send({ verification_status: 'verified' }).expect(200);
    const after = (await get('naac?year=2026')).body.data;
    expect(after.c523.rows.map((r) => r.exam).sort()).toEqual(['GATE', 'NET']);
    expect(after.c523.summary[0].count).toBe(2);

    // NBA: placed = 2 (one also in higher studies, counted once as placed), higher = 1 -> (2 + 1) / 4
    const nba = (await get('nba?year=2026')).body.data;
    const batch = nba.programmes[0].batches.find((b) => b.batch_year === 2026);
    expect(batch).toMatchObject({ students: 4, placed: 2, higher_studies: 1, entrepreneurs: null, index: 0.75 });

    const nirf = (await get('nirf?year=2026')).body.data;
    expect(nirf.rows.find((r) => r.batch_year === 2026)).toMatchObject({ graduating: 4, placed: 2, higher_studies: 2 });

    const hs = (await get('higher-studies?year=2026')).body.data;
    expect(hs.counts).toMatchObject({ verified: 2, total: 2 });
    const ce = (await get('competitive-exams?year=2026')).body.data;
    expect(ce.counts.total).toBe(2);
    expect(ce.by_exam).toMatchObject({ GATE: { total: 1, qualified: 1 }, NET: { total: 1, qualified: 1 } });
  });

  it('the student picker finds students by name or roll number, inside the admin\'s institution only', async () => {
    const ctx = await setup();
    const other = await setup();
    const mine = await seedStudent(ctx);
    await seedStudent(other);

    const all = await request(app).get('/api/v1/reports/students').set(ctx.admin.auth).expect(200);
    expect(all.body.data.map((s) => s.id)).toEqual([mine.student.id]);
    const byRoll = await request(app).get(`/api/v1/reports/students?q=${mine.student.roll_number}`).set(ctx.admin.auth).expect(200);
    expect(byRoll.body.data).toHaveLength(1);
    const none = await request(app).get('/api/v1/reports/students?q=zzzznobody').set(ctx.admin.auth).expect(200);
    expect(none.body.data).toHaveLength(0);
  });

  it('chat contacts: a student sees classmates, faculty and admins of their own institution by USER id — never outsiders or themselves', async () => {
    const ctx = await setup();
    const other = await setup();
    const me = await seedStudent(ctx);
    const classmate = await seedStudent(ctx);
    await seedStudent(other);
    const { user: faculty } = await seedUser(repos.userRepository, hashPassword, {
      role: 'faculty', institutionId: ctx.institution.id, email: `outcome-faculty-${uniq()}@example.com`,
    });

    const res = await request(app).get('/api/v1/chat/contacts').set(me.auth).expect(200);
    const ids = res.body.data.map((c) => c.id);
    // user ids (what the chat socket routes by), not student-record ids
    expect(ids).toEqual(expect.arrayContaining([classmate.user.id, faculty.id, ctx.admin.user.id]));
    expect(ids).not.toContain(classmate.student.id);
    expect(ids).not.toContain(me.user.id);
    expect(res.body.data.every((c) => c.full_name)).toBe(true);
    expect(res.body.data).toHaveLength(3); // classmate + faculty + admin; the other college's student is absent
  });

  it('the audit log lists outcome and letter events too', async () => {
    const ctx = await setup();
    const me = await seedStudent(ctx, { placement: {} });
    const created = await request(app).post('/api/v1/outcomes').set(me.auth).send({ type: 'higher_study', course: 'MSc', institution_name: 'IISc' }).expect(201);
    await request(app).put(`/api/v1/outcomes/${created.body.data.id}/verify`).set(ctx.admin.auth).send({ verification_status: 'verified' }).expect(200);
    await request(app).put(`/api/v1/placement-records/${me.record.id}/proof`).set(me.auth).attach('proof_file', PDF, { filename: 'o.pdf', contentType: 'application/pdf' }).expect(200);

    const res = await request(app).get('/api/v1/reports/audit-log').set(ctx.admin.auth).expect(200);
    const actions = res.body.data.rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['outcome_added', 'outcome_verified', 'placement_letter_attached']));
    expect(res.body.data.rows.find((r) => r.action === 'outcome_added').subject).toBe('MSc — IISc');
  });
});
