const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Brevo is never called for real: the SDK client is replaced by a mock whose
// mockSendTransacEmail is inspected. BrevoError is mocked too, since
// testAssignedEmail.service.js uses it to read the status code.
const mockSendTransacEmail = jest.fn();
jest.mock('@getbrevo/brevo', () => {
  class BrevoError extends Error {
    constructor({ message, statusCode, rawResponse }) {
      super(message);
      this.statusCode = statusCode;
      this.rawResponse = rawResponse;
    }
  }
  return {
    BrevoError,
    BrevoClient: jest.fn(() => ({ transactionalEmails: { sendTransacEmail: mockSendTransacEmail } })),
  };
});

describe('test-assigned email notifications', () => {
  let app;
  let database;
  let repos;
  let notifications;
  let notificationService;
  let sendTemplatedEmails;
  let BrevoError;
  let hashPassword;
  let institution;
  let department;
  let token;
  let seq = 0;

  beforeAll(async () => {
    process.env.BREVO_API_KEY = 'test-key';
    process.env.BREVO_SENDER_EMAIL = 'sender@example.com';
    process.env.BREVO_TEST_ASSIGNED_TEMPLATE_ID = '7';
    process.env.BREVO_BATCH_SIZE = '2';
    process.env.BREVO_MIN_REQUEST_INTERVAL_MS = '1';
    let built;
    ({ app, database, hashPassword, ...built } = await buildTestApp());
    repos = {
      institution: built.institutionRepository,
      user: built.userRepository,
      student: built.studentRepository,
      department: require('../../repositories/department.repository'),
      test: require('../../repositories/test.repository'),
      assignment: require('../../repositories/testAssignment.repository'),
    };
    notifications = require('../../repositories/emailNotification.repository');
    notificationService = require('../../services/emailNotification.service');
    ({ sendTemplatedEmails } = require('../../services/brevoBatchEmail.service'));
    ({ BrevoError } = require('@getbrevo/brevo'));

    institution = await seedInstitution(repos.institution, { code: `NOTIF-${Date.now()}` });
    department = await repos.department.create({ institution_id: institution.id, name: 'CSE', code: 'CSE' });
    const { user: admin, password } = await seedUser(repos.user, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `notif-admin-${Date.now()}@example.com`,
    });
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

  async function addStudent(batchYear) {
    seq += 1;
    const { user } = await seedUser(repos.user, hashPassword, {
      role: 'student',
      institutionId: institution.id,
      email: `notif-student-${Date.now()}-${seq}@example.com`,
    });
    const student = await repos.student.create({
      user_id: user.id,
      institution_id: institution.id,
      department_id: department.id,
      batch_year: batchYear,
      roll_number: `N-${Date.now()}-${seq}`,
    });
    return { user, student };
  }

  const processTest = (testId) =>
    notificationService.processScope({ entityType: 'test', entityId: testId, eventType: 'test_assigned', roundNumber: null });

  const newTest = (extra = {}) =>
    repos.test.create({ institution_id: institution.id, title: 'Notify Test', duration_minutes: 30, ...extra });

  const assign = (testId, batchYear) =>
    request(app)
      .post('/api/v1/test-assignments')
      .set('Authorization', `Bearer ${token}`)
      .send({ test_id: testId, department_id: department.id, batch_year: batchYear });

  it('queues one notification per student, and only the new batch when a batch is added later', async () => {
    await addStudent(2031);
    await addStudent(2031);
    const test = await newTest();

    const first = await assign(test.id, 2031).expect(201);
    expect(first.body.data.notifying_count).toBe(2);

    // Same batch again: nothing new to notify.
    const again = await assign(test.id, 2031).expect(201);
    expect(again.body.data.notifying_count).toBe(0);

    await addStudent(2032);
    const second = await assign(test.id, 2032).expect(201);
    expect(second.body.data.notifying_count).toBe(1);

    expect((await notifications.summarize('test', test.id)).total).toBe(3);
  });

  it('does not notify for a draft test, then notifies everyone assigned once it is activated', async () => {
    await addStudent(2033);
    const test = await newTest({ status: 'draft' });

    const res = await assign(test.id, 2033).expect(201);
    expect(res.body.data.notifying_count).toBe(0);
    expect((await notifications.summarize('test', test.id)).total).toBe(0);

    await request(app)
      .put(`/api/v1/tests/${test.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' })
      .expect(200);
    expect((await notifications.summarize('test', test.id)).pending).toBe(1);

    // Saving it again must not queue anything new.
    await request(app)
      .put(`/api/v1/tests/${test.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active', title: 'Renamed' })
      .expect(200);
    expect((await notifications.summarize('test', test.id)).total).toBe(1);
  });

  it('sends in messageVersions batches with the template params, and never re-sends a sent row', async () => {
    for (let i = 0; i < 3; i += 1) await addStudent(2034);
    const test = await newTest({ title: 'Params Test', duration_minutes: 45 });
    await assign(test.id, 2034).expect(201);

    const totals = await processTest(test.id);
    expect(totals).toEqual({ sent: 3, failed: 0 });
    // BREVO_BATCH_SIZE=2 → 3 students = 2 calls.
    expect(mockSendTransacEmail).toHaveBeenCalledTimes(2);
    const call = mockSendTransacEmail.mock.calls[0][0];
    expect(call.templateId).toBe(7);
    expect(call.messageVersions).toHaveLength(2);
    expect(call.messageVersions[0].params).toMatchObject({
      assessmentTitle: 'Params Test',
      departmentName: 'CSE',
      batchName: 'Batch 2034',
      durationMinutes: 45,
      testLink: 'http://localhost:3000/learner/aptitude-tests',
    });
    expect(call.messageVersions[0].params.studentName).toBeTruthy();

    expect(await processTest(test.id)).toEqual({ sent: 0, failed: 0 });
    expect(mockSendTransacEmail).toHaveBeenCalledTimes(2);
    expect(await notifications.summarize('test', test.id)).toMatchObject({ sent: 3, failed: 0, pending: 0 });
  });

  it('records an invalid email as failed without calling Brevo for it, and resends only failed rows', async () => {
    const { user } = await addStudent(2035);
    await addStudent(2035);
    await repos.user.updateById(user.id, { email: 'not-an-email' });
    const test = await newTest();
    await assign(test.id, 2035).expect(201);

    expect(await processTest(test.id)).toEqual({ sent: 1, failed: 1 });
    const sentTo = mockSendTransacEmail.mock.calls.flatMap(([r]) => r.messageVersions.flatMap((v) => v.to.map((t) => t.email)));
    expect(sentTo).not.toContain('not-an-email');

    const summary = await request(app)
      .get(`/api/v1/tests/${test.id}/notifications`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(summary.body.data).toMatchObject({ sent: 1, failed: 1, pending: 0 });
    expect(summary.body.data.failed_recipients).toHaveLength(1);
    // Fix the email, then resend failed only.
    await repos.user.updateById(user.id, { email: `fixed-${Date.now()}@example.com` });
    mockSendTransacEmail.mockClear();
    const resend = await request(app)
      .post(`/api/v1/tests/${test.id}/notifications/resend-failed`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(resend.body.data.requeued).toBe(1);
    expect(await processTest(test.id)).toEqual({ sent: 1, failed: 0 });
    expect(mockSendTransacEmail).toHaveBeenCalledTimes(1);
  });

  describe('sendTestAssignedEmails retries', () => {
    const items = [{ key: 'a', email: 'a@example.com', name: 'A', params: {} }];
    const sleep = jest.fn(async () => {});
    beforeEach(() => sleep.mockClear());

    it('waits for Retry-After on a 429, then succeeds', async () => {
      mockSendTransacEmail
        .mockRejectedValueOnce(new BrevoError({ message: 'slow down', statusCode: 429, rawResponse: { headers: new global.Headers({ 'retry-after': '3' }) } }))
        .mockResolvedValueOnce({ messageIds: ['m1'] });
      const results = await sendTemplatedEmails(items, { templateId: 7, tag: 'test_assigned', sleep, retryBaseMs: 10 });
      expect(results).toEqual([{ key: 'a', ok: true, messageId: 'm1' }]);
      expect(sleep).toHaveBeenCalledWith(3000);
    });

    it('backs off exponentially on 5xx and gives up after 3 attempts', async () => {
      mockSendTransacEmail.mockRejectedValue(new BrevoError({ message: 'boom', statusCode: 503 }));
      const results = await sendTemplatedEmails(items, { templateId: 7, tag: 'test_assigned', sleep, retryBaseMs: 10 });
      expect(mockSendTransacEmail).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 20]);
      expect(results[0]).toMatchObject({ key: 'a', ok: false });
    });

    it('does not retry a 4xx', async () => {
      mockSendTransacEmail.mockRejectedValue(new BrevoError({ message: 'unauthorized', statusCode: 401 }));
      const results = await sendTemplatedEmails(items, { templateId: 7, tag: 'test_assigned', sleep, retryBaseMs: 10 });
      expect(mockSendTransacEmail).toHaveBeenCalledTimes(1);
      expect(results[0].ok).toBe(false);
    });
  });
});
