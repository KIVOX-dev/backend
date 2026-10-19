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

describe('student onboarding (account created) emails', () => {
  let app;
  let database;
  let repos;
  let emailNotification;
  let notifications;
  let institution;
  let token;
  let hashPassword;
  let seq = 0;

  beforeAll(async () => {
    process.env.BREVO_API_KEY = 'test-key';
    process.env.BREVO_SENDER_EMAIL = 'sender@example.com';
    process.env.BREVO_ACCOUNT_CREATED_TEMPLATE_ID = '21';
    process.env.BREVO_BATCH_SIZE = '50';
    process.env.BREVO_MIN_REQUEST_INTERVAL_MS = '1';
    let built;
    ({ app, database, hashPassword, ...built } = await buildTestApp());
    repos = { institution: built.institutionRepository, user: built.userRepository, student: built.studentRepository };
    emailNotification = require('../../services/emailNotification.service');
    notifications = require('../../repositories/emailNotification.repository');

    institution = await seedInstitution(repos.institution, { code: `ONB-${Date.now()}` });
    const { user: admin, password } = await seedUser(repos.user, hashPassword, {
      role: 'institution_admin',
      institutionId: institution.id,
      email: `onb-admin-${Date.now()}@example.com`,
    });
    token = (await request(app).post('/api/v1/auth/login').send({ email: admin.email, password }).expect(200)).body.data.accessToken;
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  beforeEach(() => {
    mockSendTransacEmail.mockReset();
    mockSendTransacEmail.mockImplementation(async (req) => ({ messageIds: req.messageVersions.map((_, i) => `m${i}`) }));
  });

  const api = (method, path) => request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  const processInstitution = () =>
    emailNotification.processScope({ entityType: 'institution', entityId: institution.id, eventType: 'account_created', roundNumber: null });
  const email = () => `onb-${Date.now()}-${(seq += 1)}@example.com`;
  const sentVersions = () => mockSendTransacEmail.mock.calls.flatMap(([r]) => r.messageVersions);

  it('queues one job for a whole roster, skips placeholder emails, and batches the send', async () => {
    const students = Array.from({ length: 5 }, (_, i) => ({ name: `Roster ${i}`, email: email(), roll: `R${Date.now()}${i}` }));
    students.push({ name: 'No Email', roll: `NE${Date.now()}` }); // synthetic address — nobody to email
    const res = await api('post', '/students/batch').send({ students, year: 2031 }).expect(201);
    expect(res.body.data.created).toBe(6);
    expect(res.body.data.notifying_count).toBe(5);

    expect(await processInstitution()).toEqual({ sent: 5, failed: 0 });
    expect(mockSendTransacEmail).toHaveBeenCalledTimes(1); // one messageVersions call, not 5
    const call = mockSendTransacEmail.mock.calls[0][0];
    expect(call.templateId).toBe(21);
    expect(call.messageVersions).toHaveLength(5);
    expect(call.messageVersions[0].params).toMatchObject({
      studentName: 'Roster 0',
      tempPassword: 'student123',
      loginUrl: 'http://localhost:3000/institutional',
    });
    expect(call.messageVersions[0].params.email).toBe(students[0].email);

    // Nothing is ever sent twice.
    expect(await processInstitution()).toEqual({ sent: 0, failed: 0 });
    expect(mockSendTransacEmail).toHaveBeenCalledTimes(1);
  });

  it('emails a student added through the single Add Student form (default password shown)', async () => {
    const studentEmail = email();
    const res = await api('post', '/users').send({
      email: studentEmail, full_name: 'Solo Student', role: 'student', password: 'student123', roll_number: `SOLO${Date.now()}`, year: 2032,
    }).expect(201);
    expect(res.body.data.notifying_count).toBe(1);

    await processInstitution();
    const version = sentVersions().find((v) => v.to[0].email === studentEmail);
    expect(version.params).toMatchObject({ studentName: 'Solo Student', tempPassword: 'student123' });
  });

  it('never puts a custom password in the email', async () => {
    const studentEmail = email();
    const res = await api('post', '/users').send({
      email: studentEmail, full_name: 'Custom Pw', role: 'student', password: 'Chosen-By-Admin-9', roll_number: `CP${Date.now()}`, year: 2032,
    }).expect(201);
    expect(res.body.data.notifying_count).toBe(1);

    await processInstitution();
    const version = sentVersions().find((v) => v.to[0].email === studentEmail);
    expect(version.params.tempPassword).toBe('');
    expect(JSON.stringify(mockSendTransacEmail.mock.calls)).not.toContain('Chosen-By-Admin-9');
  });

  it('records failures, lists them, and resends only the failed ones', async () => {
    const ok = email();
    const bad = email();
    await api('post', '/students/batch').send({ students: [{ name: 'Ok', email: ok, roll: `OK${Date.now()}` }, { name: 'Bad', email: bad, roll: `BD${Date.now()}` }], year: 2033 }).expect(201);

    mockSendTransacEmail.mockRejectedValue(Object.assign(new Error('nope'), { statusCode: 401 }));
    expect(await processInstitution()).toEqual({ sent: 0, failed: 2 });

    const failed = await api('get', '/students/onboarding-emails').expect(200);
    expect(failed.body.data).toMatchObject({ failed: 2, pending: 0 });
    expect(failed.body.data.failed_recipients).toHaveLength(2);

    mockSendTransacEmail.mockReset();
    mockSendTransacEmail.mockImplementation(async (req) => ({ messageIds: req.messageVersions.map(() => 'ok') }));
    const resend = await api('post', '/students/onboarding-emails/resend-failed').send({}).expect(200);
    expect(resend.body.data.requeued).toBe(2);
    expect(await processInstitution()).toEqual({ sent: 2, failed: 0 });

    // A second resend has nothing to do — sent rows are never touched.
    const again = await api('post', '/students/onboarding-emails/resend-failed').send({}).expect(200);
    expect(again.body.data.requeued).toBe(0);
    expect((await notifications.summarize('institution', institution.id, { eventType: 'account_created' })).failed).toBe(0);
    expect(ok && bad).toBeTruthy();
  });

  it('is staff-only', async () => {
    const { user, password } = await seedUser(repos.user, hashPassword, {
      role: 'student', institutionId: institution.id, email: email(),
    });
    const studentToken = (await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200)).body.data.accessToken;
    await request(app).get('/api/v1/students/onboarding-emails').set('Authorization', `Bearer ${studentToken}`).expect(403);
    await request(app).post('/api/v1/students/onboarding-emails/resend-failed').set('Authorization', `Bearer ${studentToken}`).send({}).expect(403);
  });
});
