const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Reports & Compliance: NIRF placement table, offer-letter status/reminders,
// and the placement audit log — all scoped to the caller's own institution
// and closed to everyone but institution/super admins.
describe('Reports & Compliance', () => {
  let app;
  let database;
  let repos;
  let hashPassword;
  let departmentRepository;
  let notificationRepository;

  beforeAll(async () => {
    const built = await buildTestApp();
    ({ app, database, hashPassword } = built);
    repos = built;
    departmentRepository = require('../../repositories/department.repository');
    notificationRepository = require('../../repositories/notification.repository');
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  let counter = 0;
  const uniq = () => `${Date.now()}-${(counter += 1)}`;

  async function login(email, password) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.data.accessToken;
  }

  async function seedAdmin(institutionId, role = 'institution_admin') {
    const { user, password } = await seedUser(repos.userRepository, hashPassword, {
      role,
      institutionId,
      email: `report-admin-${uniq()}@example.com`,
    });
    return { user, token: await login(user.email, password) };
  }

  async function seedStudent(institutionId, departmentId, batchYear, record) {
    const { user, password } = await seedUser(repos.userRepository, hashPassword, {
      role: 'student',
      institutionId,
      email: `report-student-${uniq()}@example.com`,
      full_name: `Student ${uniq()}`,
    });
    const student = await repos.studentRepository.create({
      user_id: user.id,
      institution_id: institutionId,
      department_id: departmentId,
      batch_year: batchYear,
    });
    const created = record
      ? await repos.placementRecordRepository.create({
          student_id: student.id,
          institution_id: institutionId,
          company_name: 'Acme',
          role: 'SDE',
          ...record,
        })
      : null;
    return { user, password, student, record: created };
  }

  async function setup() {
    const institution = await seedInstitution(repos.institutionRepository, { code: `RPT-${uniq()}` });
    const department = await departmentRepository.create({ institution_id: institution.id, name: 'Computer Science', code: 'CS' });
    return { institution, department };
  }

  it('NIRF: counts graduating/placed, takes the median of verified salaries, flags missing outcomes', async () => {
    const { institution, department } = await setup();
    const other = await setup();
    await seedStudent(institution.id, department.id, 2026, { salary_lpa: 10, verification_status: 'verified' });
    await seedStudent(institution.id, department.id, 2026, { salary_lpa: 6, verification_status: 'verified' });
    await seedStudent(institution.id, department.id, 2026, { salary_lpa: 40, verification_status: 'pending' }); // not verified: neither placed nor in the median
    await seedStudent(institution.id, department.id, 2026, null); // no outcome at all
    await seedStudent(other.institution.id, other.department.id, 2026, { salary_lpa: 99, verification_status: 'verified' }); // another college

    const { token } = await seedAdmin(institution.id);
    const res = await request(app).get('/api/v1/reports/nirf?year=2026').set('Authorization', `Bearer ${token}`).expect(200);

    const row = res.body.data.rows.find((r) => r.batch_year === 2026);
    expect(row).toMatchObject({ department: 'Computer Science', graduating: 4, placed: 2, median_salary_lpa: 8, higher_studies: 0 });
    expect(row.placement_pct).toBe(50);
    expect(res.body.data.batches).toEqual([2026, 2025, 2024]);
    expect(res.body.data.completeness).toEqual({ missing_outcome: 1, total_students: 4, pending_verification: 1 });
  });

  it('offer letters: buckets records by letter status, and reminders go only to students still missing one', async () => {
    const { institution, department } = await setup();
    const needs = await seedStudent(institution.id, department.id, 2026, {}); // no proof
    await seedStudent(institution.id, department.id, 2026, { proof_url: '/uploads/placement-proof/x/a.pdf' }); // uploaded
    await seedStudent(institution.id, department.id, 2026, { proof_url: '/uploads/placement-proof/x/b.pdf', verification_status: 'verified' });

    const { token } = await seedAdmin(institution.id);
    const auth = { Authorization: `Bearer ${token}` };

    const res = await request(app).get('/api/v1/reports/offer-letters').set(auth).expect(200);
    expect(res.body.data.counts).toEqual({ pending: 1, uploaded: 1, verified: 1, rejected: 0, total: 3 });

    // The academic-year filter arrives as a query string but batch_year is stored as a number.
    const inYear = await request(app).get('/api/v1/reports/offer-letters?year=2026').set(auth).expect(200);
    expect(inYear.body.data.counts.total).toBe(3);
    const otherYear = await request(app).get('/api/v1/reports/offer-letters?year=2020').set(auth).expect(200);
    expect(otherYear.body.data.counts.total).toBe(0);

    const first = await request(app).post('/api/v1/reports/offer-letters/remind').set(auth).expect(200);
    expect(first.body.data).toMatchObject({ sent: 1, skipped: 0 });
    const notes = await notificationRepository.findAll({ filters: { user_id: needs.user.id } });
    expect(notes.rows).toHaveLength(1);

    // ...and the student can actually see it, and mark it read.
    const studentAuth = { Authorization: `Bearer ${await login(needs.user.email, needs.password)}` };
    const inbox = await request(app).get('/api/v1/notifications').set(studentAuth).expect(200);
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0]).toMatchObject({ title: 'Offer letter needed', is_read: false });
    await request(app).patch(`/api/v1/notifications/${inbox.body.data[0].id}/read`).set(studentAuth).expect(200);
    const after = await request(app).get('/api/v1/notifications').set(studentAuth).expect(200);
    expect(after.body.data[0].is_read).toBe(true);

    // Once read, a fresh reminder is allowed again — the student dealt with the last one.
    const second = await request(app).post('/api/v1/reports/offer-letters/remind').set(auth).expect(200);
    expect(second.body.data).toMatchObject({ sent: 1, skipped: 0 });

    // But an unread one already waiting isn't stacked on.
    const third = await request(app).post('/api/v1/reports/offer-letters/remind').set(auth).expect(200);
    expect(third.body.data).toMatchObject({ sent: 0, skipped: 1 });
  });

  it('audit log: verifications and deletions are recorded with who did it, and stay inside the institution', async () => {
    const { institution, department } = await setup();
    const other = await setup();
    const { record } = await seedStudent(institution.id, department.id, 2026, {});

    const { user: adminUser, token } = await seedAdmin(institution.id);
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).put(`/api/v1/placement-records/${record.id}/verify`).set(auth).send({ verification_status: 'verified' }).expect(200);
    await request(app).delete(`/api/v1/placement-records/${record.id}`).set(auth).expect(200);

    const res = await request(app).get('/api/v1/reports/audit-log').set(auth).expect(200);
    const actions = res.body.data.rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['placement_verified', 'placement_deleted']));
    expect(res.body.data.rows[0].actor).toBe(adminUser.full_name);

    const { token: otherToken } = await seedAdmin(other.institution.id);
    const otherRes = await request(app).get('/api/v1/reports/audit-log').set('Authorization', `Bearer ${otherToken}`).expect(200);
    expect(otherRes.body.data.rows).toHaveLength(0);
  });

  it('is closed to students and faculty, and a super_admin must name an institution', async () => {
    const { institution, department } = await setup();
    const { user, password } = await seedUser(repos.userRepository, hashPassword, {
      role: 'student', institutionId: institution.id, email: `report-deny-${uniq()}@example.com`,
    });
    await repos.studentRepository.create({ user_id: user.id, institution_id: institution.id, department_id: department.id });
    const studentToken = await login(user.email, password);
    await request(app).get('/api/v1/reports/nirf').set('Authorization', `Bearer ${studentToken}`).expect(403);

    const { token: superToken } = await seedAdmin(institution.id, 'super_admin');
    await request(app).get('/api/v1/reports/nirf').set('Authorization', `Bearer ${superToken}`).expect(400);
    await request(app).get(`/api/v1/reports/nirf?institution_id=${institution.id}`).set('Authorization', `Bearer ${superToken}`).expect(200);
  });

  it('an admin cannot delete another institution\'s placement', async () => {
    const a = await setup();
    const b = await setup();
    const { record } = await seedStudent(a.institution.id, a.department.id, 2026, {});
    const { token } = await seedAdmin(b.institution.id);
    await request(app).delete(`/api/v1/placement-records/${record.id}`).set('Authorization', `Bearer ${token}`).expect(403);
  });
});
