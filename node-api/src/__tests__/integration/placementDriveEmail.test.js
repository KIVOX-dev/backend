const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Brevo is never called for real — see testAssignedEmail.test.js.
const mockSendTransacEmail = jest.fn();
jest.mock('@getbrevo/brevo', () => {
  class BrevoError extends Error {
    constructor({ message, statusCode }) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    BrevoError,
    BrevoClient: jest.fn(() => ({ transactionalEmails: { sendTransacEmail: mockSendTransacEmail } })),
  };
});

const PUBLIC_BUCKET = 'test-public-logos';
const LOGO_URL = `https://storage.googleapis.com/${PUBLIC_BUCKET}/company-logo/abc-123.png`;

describe('placement drive email notifications', () => {
  let app;
  let database;
  let repos;
  let emailNotification;
  let notifications;
  let hashPassword;
  let institution;
  let department;
  let adminId;
  let token;
  let seq = 0;

  beforeAll(async () => {
    process.env.BREVO_API_KEY = 'test-key';
    process.env.BREVO_SENDER_EMAIL = 'sender@example.com';
    process.env.BREVO_DRIVE_ASSIGNED_TEMPLATE_ID = '11';
    process.env.BREVO_ROUND_SHORTLIST_TEMPLATE_ID = '12';
    process.env.BREVO_BATCH_SIZE = '50';
    process.env.BREVO_MIN_REQUEST_INTERVAL_MS = '1';
    process.env.GCS_PUBLIC_LOGO_BUCKET = PUBLIC_BUCKET;
    let built;
    ({ app, database, hashPassword, ...built } = await buildTestApp());
    repos = {
      institution: built.institutionRepository,
      user: built.userRepository,
      student: built.studentRepository,
      department: require('../../repositories/department.repository'),
      placement: require('../../repositories/placement.repository'),
    };
    emailNotification = require('../../services/emailNotification.service');
    notifications = require('../../repositories/emailNotification.repository');

    institution = await seedInstitution(repos.institution, { code: `DRV-${Date.now()}` });
    department = await repos.department.create({ institution_id: institution.id, name: 'CSE', code: 'CSE' });
    const { user: admin, password } = await seedUser(repos.user, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `drive-admin-${Date.now()}@example.com`,
    });
    adminId = admin.id;
    const res = await request(app).post('/api/v1/auth/login').send({ email: admin.email, password }).expect(200);
    token = res.body.data.accessToken;
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  beforeEach(() => {
    mockSendTransacEmail.mockReset();
    mockSendTransacEmail.mockImplementation(async (req) => ({
      messageIds: req.messageVersions.map((_, i) => `msg-${i}`),
    }));
  });

  async function addStudent({ batchYear, cgpa, fullName } = {}) {
    seq += 1;
    const { user } = await seedUser(repos.user, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `drive-student-${Date.now()}-${seq}@example.com`,
      full_name: fullName || `Student ${seq}`,
    });
    const student = await repos.student.create({
      user_id: user.id,
      institution_id: institution.id,
      department_id: department.id,
      batch_year: batchYear,
      cgpa,
      roll_number: `D-${Date.now()}-${seq}`,
    });
    return { user, student };
  }

  const api = (method, path) => request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  const createDrive = (body) =>
    api('post', '/placements').send({ title: 'SDE', company_name: 'Acme', status: 'open', ...body });
  const processScope = (driveId, eventType, roundNumber = null) =>
    emailNotification.processScope({ entityType: 'drive', entityId: driveId, eventType, roundNumber });
  const summary = (driveId, filters) => notifications.summarize('drive', driveId, filters);
  const sentParams = () => mockSendTransacEmail.mock.calls.flatMap(([r]) => r.messageVersions.map((v) => v.params));

  describe('drive assigned', () => {
    it('emails only students who meet the eligibility rules, and only newly eligible ones later', async () => {
      const ok1 = await addStudent({ batchYear: 2040, cgpa: 8 });
      await addStudent({ batchYear: 2040, cgpa: 8.5 });
      await addStudent({ batchYear: 2040, cgpa: 6 }); // below min_cgpa
      await addStudent({ batchYear: 2040 }); // no CGPA on record
      await addStudent({ batchYear: 2041, cgpa: 9 }); // not in an eligible batch yet

      const created = await createDrive({ eligible_years: [2040], min_cgpa: 7 }).expect(201);
      expect(created.body.data.notifying_count).toBe(2);
      const driveId = created.body.data.id;

      // Saving again with nothing new notifies nobody.
      const resave = await api('put', `/placements/${driveId}`).send({ eligible_years: [2040], min_cgpa: 7 }).expect(200);
      expect(resave.body.data.notifying_count).toBe(0);

      // Adding a batch emails only that batch's students.
      const widened = await api('put', `/placements/${driveId}`).send({ eligible_years: [2040, 2041], min_cgpa: 7 }).expect(200);
      expect(widened.body.data.notifying_count).toBe(1);
      expect((await summary(driveId)).total).toBe(3);
      expect(ok1).toBeTruthy();
    });

    it('does not notify for a draft drive, then notifies once it is opened', async () => {
      await addStudent({ batchYear: 2042, cgpa: 8 });
      const draft = await createDrive({ status: 'draft', eligible_years: [2042] }).expect(201);
      expect(draft.body.data.notifying_count).toBe(0);

      const opened = await api('put', `/placements/${draft.body.data.id}`).send({ status: 'open' }).expect(200);
      expect(opened.body.data.notifying_count).toBe(1);
    });

    it('sends the template params, with the range, IST dates, summary and public logo', async () => {
      await addStudent({ batchYear: 2043, cgpa: 8, fullName: 'Asha Rao' });
      const created = await createDrive({
        eligible_years: [2043],
        min_cgpa: 7,
        salary_min_lpa: 8,
        salary_max_lpa: 12,
        package_lpa: 10,
        location: 'Bengaluru',
        drive_date: '2043-03-10T00:00:00.000Z',
        application_deadline: '2043-03-01T00:00:00.000Z',
        company_logo_url: LOGO_URL,
      }).expect(201);

      expect(await processScope(created.body.data.id, 'drive_assigned')).toEqual({ sent: 1, failed: 0 });
      const call = mockSendTransacEmail.mock.calls[0][0];
      expect(call.templateId).toBe(11);
      expect(call.messageVersions[0].params).toEqual({
        studentName: 'Asha Rao',
        companyName: 'Acme',
        companyLogoUrl: LOGO_URL,
        jobRole: 'SDE',
        packageCtc: '₹8–12 LPA',
        location: 'Bengaluru',
        driveDate: '10 Mar 2043',
        lastDateToApply: '1 Mar 2043',
        eligibilitySummary: 'Batches: 2043 · Minimum CGPA: 7',
        driveLink: 'http://localhost:3000/learner/placements',
      });

      expect(await processScope(created.body.data.id, 'drive_assigned')).toEqual({ sent: 0, failed: 0 });
      expect(mockSendTransacEmail).toHaveBeenCalledTimes(1);
    });

    it('passes an empty companyLogoUrl when the drive has no public logo', async () => {
      await addStudent({ batchYear: 2044, cgpa: 8 });
      const created = await createDrive({ eligible_years: [2044], package_lpa: 6 }).expect(201);
      await processScope(created.body.data.id, 'drive_assigned');
      expect(sentParams()[0]).toMatchObject({ companyLogoUrl: '', packageCtc: '₹6 LPA' });
    });

    it('rejects a logo URL that is not one of ours', async () => {
      await createDrive({ company_logo_url: 'https://evil.example.com/track.png' }).expect(400);
    });
  });

  describe('round shortlist', () => {
    let driveId;
    let students;

    beforeAll(async () => {
      students = [await addStudent({ batchYear: 2045, cgpa: 8, fullName: 'Ravi K' }), await addStudent({ batchYear: 2045, cgpa: 8 })];
      driveId = (await createDrive({ eligible_years: [2045], company_logo_url: LOGO_URL }).expect(201)).body.data.id;
    });

    const shortlist = (student, round) =>
      api('post', '/placement-applications').send({ placement_id: driveId, student_id: student.student.id, round });

    it('does not email for round 1 or for a shortlist with no round', async () => {
      const r1 = await shortlist(students[0], 1).expect(201);
      expect(r1.body.data.notifying_count).toBe(0);
      const none = await shortlist(students[0], undefined).expect(201);
      expect(none.body.data.notifying_count).toBe(0);
    });

    it('emails once per student per round, even if re-shortlisted, with the round details', async () => {
      await api('put', `/drives/${driveId}/rounds/2`)
        .send({ name: 'Technical Interview', scheduled_at: '2045-04-05T04:30:00.000Z', venue_or_link: 'https://meet.example.com/x', instructions: 'Bring your ID.' })
        .expect(200);

      const first = await shortlist(students[0], 2).expect(201);
      expect(first.body.data.notifying_count).toBe(1);

      // Un-shortlist (rejected), then shortlist the same student for the same round again.
      const app1 = first.body.data;
      await api('patch', `/placement-applications/${app1.id}/status`).send({ status: 'rejected' }).expect(200);
      const again = await shortlist(students[0], 2).expect(201);
      expect(again.body.data.notifying_count).toBe(0);

      expect(await processScope(driveId, 'round_shortlisted', 2)).toEqual({ sent: 1, failed: 0 });
      const call = mockSendTransacEmail.mock.calls[0][0];
      expect(call.templateId).toBe(12);
      expect(call.messageVersions[0].params).toEqual({
        studentName: 'Ravi K',
        companyName: 'Acme',
        companyLogoUrl: LOGO_URL,
        jobRole: 'SDE',
        roundNumber: 2,
        roundName: 'Technical Interview',
        roundDateTime: '5 Apr 2045, 10:00 am IST',
        venueOrLink: 'https://meet.example.com/x',
        instructions: 'Bring your ID.',
        driveLink: 'http://localhost:3000/learner/placements',
      });
    });

    it('batches a bulk shortlist and sends later rounds without defined details', async () => {
      const res = await api('post', '/placement-applications/bulk-shortlist')
        .send({ placement_id: driveId, round: 3, student_ids: students.map((s) => s.student.id) })
        .expect(200);
      expect(res.body.data.notifying_count).toBe(2);

      expect(await processScope(driveId, 'round_shortlisted', 3)).toEqual({ sent: 2, failed: 0 });
      expect(mockSendTransacEmail).toHaveBeenCalledTimes(1); // both in one messageVersions call
      expect(sentParams()[0]).toMatchObject({ roundNumber: 3, roundName: 'Round 3', roundDateTime: '', venueOrLink: '', instructions: '' });
    });

    it('lists notifications filtered by event/round and resends only failed ones for a round', async () => {
      // Make the next round-4 sends fail at Brevo.
      const extra = await addStudent({ batchYear: 2045, cgpa: 8 });
      await shortlist(extra, 4).expect(201);
      mockSendTransacEmail.mockRejectedValue(Object.assign(new Error('nope'), { statusCode: 401 }));
      await processScope(driveId, 'round_shortlisted', 4);

      const round4 = await api('get', `/drives/${driveId}/notifications?event_type=round_shortlisted&round_number=4`).expect(200);
      expect(round4.body.data).toMatchObject({ sent: 0, failed: 1, pending: 0, total: 1 });
      expect(round4.body.data.failed_recipients).toHaveLength(1);

      const round3 = await api('get', `/drives/${driveId}/notifications?round_number=3`).expect(200);
      expect(round3.body.data).toMatchObject({ sent: 2, failed: 0 });

      mockSendTransacEmail.mockReset();
      mockSendTransacEmail.mockImplementation(async (r) => ({ messageIds: r.messageVersions.map(() => 'ok') }));
      const resend = await api('post', `/drives/${driveId}/notifications/resend-failed`).send({ round_number: 3 }).expect(200);
      expect(resend.body.data.requeued).toBe(0); // round 3 had no failures

      const resend4 = await api('post', `/drives/${driveId}/notifications/resend-failed`).send({ round_number: 4 }).expect(200);
      expect(resend4.body.data.requeued).toBe(1);
      expect(await processScope(driveId, 'round_shortlisted', 4)).toEqual({ sent: 1, failed: 0 });
    });

    it('is staff-only and institution-scoped', async () => {
      const { user, password } = await seedUser(repos.user, hashPassword, {
        role: 'student', institutionId: institution.id, email: `drive-stu-${Date.now()}@example.com`,
      });
      const studentToken = (await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200)).body.data.accessToken;
      await request(app).get(`/api/v1/drives/${driveId}/notifications`).set('Authorization', `Bearer ${studentToken}`).expect(403);
      expect(adminId).toBeTruthy();
    });
  });

  it('never emails for an HR posting that has no institution', async () => {
    const drive = await repos.placement.create({ title: 'HR job', status: 'open', company_name: 'Hirer' });
    const driveNotification = require('../../services/driveNotification.service');
    expect(await driveNotification.notifyDriveAssigned(drive)).toBe(0);
  });
});
