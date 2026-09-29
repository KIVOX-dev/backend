const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');

// Brevo is never called: the email service is stubbed and inspected.
jest.mock('../../services/email.service', () => ({
  isEmailConfigured: jest.fn().mockReturnValue(true),
  sendEmail: jest.fn().mockResolvedValue({ sent: true }),
}));

describe('POST /contact/sales (Talk to Sales)', () => {
  let app;
  let database;
  let emailService;
  let turnstileService;

  const valid = {
    name: 'Priya Raman',
    organization: 'PSG College',
    email: 'priya@psg.edu',
    phone: '+91 98765 43210',
    product: 'campus_placements',
    message: 'We run 40 drives a year.',
    turnstileToken: 'test-turnstile-token',
  };

  beforeAll(async () => {
    process.env.SALES_INBOX_EMAIL = 'sales-inbox@example.com';
    ({ app, database } = await buildTestApp());
    emailService = require('../../services/email.service');
    turnstileService = require('../../services/turnstile.service');
  });

  afterAll(async () => {
    await teardownTestApp(database);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    emailService.isEmailConfigured.mockReturnValue(true);
    emailService.sendEmail.mockResolvedValue({ sent: true });
    turnstileService.verifyToken.mockResolvedValue({ success: true });
  });

  it('emails the request to the sales inbox with Reply-To set to the visitor', async () => {
    await request(app).post('/api/v1/contact/sales').send(valid).expect(200);

    expect(emailService.sendEmail).toHaveBeenCalledTimes(2);
    const ack = emailService.sendEmail.mock.calls[1][0];
    expect(ack.to).toBe('priya@psg.edu');
    expect(ack.text).toContain('Thank you for contacting TalentSnaps');
    const mail = emailService.sendEmail.mock.calls[0][0];
    expect(mail).toMatchObject({ to: 'sales-inbox@example.com', replyTo: 'priya@psg.edu' });
    expect(mail.subject).toContain('PSG College');
    expect(mail.text).toContain('Campus placements');
    expect(mail.text).toContain('We run 40 drives a year.');
  });

  it('escapes visitor text in the HTML email', async () => {
    await request(app)
      .post('/api/v1/contact/sales')
      .send({ ...valid, message: '<img src=x onerror=alert(1)>' })
      .expect(200);
    const { html } = emailService.sendEmail.mock.calls[0][0];
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('rejects missing required fields and an unknown product', async () => {
    const { phone, ...noPhone } = valid;
    await request(app).post('/api/v1/contact/sales').send(noPhone).expect(400);
    await request(app).post('/api/v1/contact/sales').send({ ...valid, product: 'pizza' }).expect(400);
    await request(app).post('/api/v1/contact/sales').send({ ...valid, email: 'not-an-email' }).expect(400);
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('fails the Turnstile check without sending anything', async () => {
    turnstileService.verifyToken.mockResolvedValue({ success: false });
    await request(app).post('/api/v1/contact/sales').send(valid).expect(403);
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('returns 503 with the inbox address when email is not configured', async () => {
    emailService.isEmailConfigured.mockReturnValue(false);
    const res = await request(app).post('/api/v1/contact/sales').send(valid).expect(503);
    expect(res.body.message).toContain('sales-inbox@example.com');
  });

  it('returns 503 when the send itself fails', async () => {
    emailService.sendEmail.mockResolvedValue({ sent: false, reason: 'send_failed' });
    await request(app).post('/api/v1/contact/sales').send(valid).expect(503);
  });
});
