const crypto = require('crypto');
const request = require('supertest');
const { buildTestApp, teardownTestApp } = require('../helpers/testApp');
const { seedInstitution, seedUser } = require('../helpers/seed');

// Razorpay Standard Checkout: server-priced plans, signature verification, one-time settlement.
// The Razorpay SDK is mocked, so no network is touched.
const mockOrdersCreate = jest.fn();
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({ orders: { create: mockOrdersCreate } })));

const SECRET = 'test-razorpay-secret';

describe('/payments', () => {
  let app;
  let database;
  let userRepository;
  const tokens = {};
  const users = {};
  let orderSeq = 0;

  const sign = (orderId, paymentId, secret = SECRET) =>
    crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  const auth = (who) => ({ Authorization: `Bearer ${tokens[who]}` });
  const createOrder = (who, plan_id = 'pro_6m') =>
    request(app).post('/api/v1/payments/create-order').set(auth(who)).send({ plan_id });
  const verify = (who, body) => request(app).post('/api/v1/payments/verify').set(auth(who)).send(body);

  beforeAll(async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = SECRET;
    const built = await buildTestApp();
    ({ app, database, userRepository } = built);
    const inst = await seedInstitution(built.institutionRepository, { code: `PAY-${Date.now()}` });
    const login = async (name, role, institutionId) => {
      const { user, password } = await seedUser(built.userRepository, built.hashPassword, {
        role, institutionId, email: `${name}-pay-${Date.now()}@example.com`,
      });
      users[name] = user;
      const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
      tokens[name] = res.body.data.accessToken;
    };
    await login('learner', 'student', null);
    await login('learner2', 'student', null);
    await login('collegeStudent', 'student', inst.id);
    await login('hr', 'hr', null);
    await login('admin', 'institution_admin', inst.id);
    await login('faculty', 'faculty', inst.id);
  });

  beforeEach(() => {
    mockOrdersCreate.mockReset();
    mockOrdersCreate.mockImplementation(async ({ amount, currency }) => ({ id: `order_${++orderSeq}`, amount, currency }));
  });
  afterAll(async () => {
    await teardownTestApp(database);
  });

  it('lists the two plans with server-side prices', async () => {
    const res = await request(app).get('/api/v1/payments/plans').set(auth('learner')).expect(200);
    expect(res.body.data.map((p) => [p.id, p.amount])).toEqual([['pro_6m', 11900], ['pro_12m', 21900]]);
  });

  it('creates an order for a learner and an HR user, pricing from the plan id', async () => {
    const a = await createOrder('learner', 'pro_6m').expect(201);
    expect(a.body.data).toMatchObject({ amount: 11900, currency: 'INR', key_id: 'rzp_test_key', plan_id: 'pro_6m' });
    expect(mockOrdersCreate.mock.calls[0][0]).toMatchObject({ amount: 11900, currency: 'INR' });
    const b = await createOrder('hr', 'pro_12m').expect(201);
    expect(b.body.data.amount).toBe(21900);
  });

  it('ignores a client-sent amount and rejects unknown plans', async () => {
    await request(app).post('/api/v1/payments/create-order').set(auth('learner')).send({ plan_id: 'pro_6m', amount: 100 }).expect(201);
    expect(mockOrdersCreate.mock.calls[0][0].amount).toBe(11900);
    await createOrder('learner', 'free_forever').expect(400);
  });

  it('blocks institutional accounts and other roles', async () => {
    await createOrder('collegeStudent').expect(403);
    await createOrder('admin').expect(403);
    await createOrder('faculty').expect(403);
    await request(app).post('/api/v1/payments/create-order').send({ plan_id: 'pro_6m' }).expect(401);
    expect(mockOrdersCreate).not.toHaveBeenCalled();
  });

  it('answers 502 (not 401) when Razorpay rejects the server credentials, and 500 on other gateway errors', async () => {
    mockOrdersCreate.mockRejectedValueOnce({ statusCode: 401, error: { description: 'Authentication failed' } });
    const auth401 = await createOrder('learner').expect(502);
    expect(auth401.body.code).toBe('PAYMENT_GATEWAY_AUTH');
    mockOrdersCreate.mockRejectedValueOnce({ statusCode: 500, error: { description: 'boom' } });
    await createOrder('learner').expect(500);
  });

  it('verifies a valid signature, applies the plan, and is idempotent on retry', async () => {
    const { order_id } = (await createOrder('learner2', 'pro_12m').expect(201)).body.data;
    const body = { razorpay_order_id: order_id, razorpay_payment_id: 'pay_1', razorpay_signature: sign(order_id, 'pay_1') };
    const first = await verify('learner2', body).expect(200);
    expect(first.body.data).toMatchObject({ verified: true, already_processed: false, plan_id: 'pro_12m' });

    const stored = await userRepository.findById(users.learner2.id);
    expect(stored.preferences.plan).toBe('pro');
    const months = (new Date(stored.preferences.plan_expires_at) - Date.now()) / (30 * 24 * 3600 * 1000);
    expect(months).toBeGreaterThan(11.5);
    expect(months).toBeLessThan(12.5);

    const again = await verify('learner2', body).expect(200);
    expect(again.body.data.already_processed).toBe(true);
    const afterRetry = await userRepository.findById(users.learner2.id);
    expect(afterRetry.preferences.plan_expires_at).toBe(stored.preferences.plan_expires_at);
  });

  it('rejects a wrong signature with 400 and does not grant the plan', async () => {
    const { order_id } = (await createOrder('hr').expect(201)).body.data;
    const res = await verify('hr', { razorpay_order_id: order_id, razorpay_payment_id: 'pay_x', razorpay_signature: sign(order_id, 'pay_x', 'wrong-secret') }).expect(400);
    expect(res.body.code).toBe('PAYMENT_SIGNATURE_MISMATCH');
    const stored = await userRepository.findById(users.hr.id);
    expect(stored.preferences?.plan).not.toBe('pro');
  });

  it('rejects missing fields with 400 and another user\'s order with 404', async () => {
    await verify('learner', { razorpay_order_id: 'order_x' }).expect(400);
    const { order_id } = (await createOrder('learner').expect(201)).body.data;
    await verify('hr', { razorpay_order_id: order_id, razorpay_payment_id: 'pay_y', razorpay_signature: sign(order_id, 'pay_y') }).expect(404);
  });

  it('refuses a second payment id on an already settled order', async () => {
    const { order_id } = (await createOrder('learner').expect(201)).body.data;
    await verify('learner', { razorpay_order_id: order_id, razorpay_payment_id: 'pay_a', razorpay_signature: sign(order_id, 'pay_a') }).expect(200);
    await verify('learner', { razorpay_order_id: order_id, razorpay_payment_id: 'pay_b', razorpay_signature: sign(order_id, 'pay_b') }).expect(409);
  });

  it('stops a user granting themselves the plan through a profile update', async () => {
    const cheat = await request(app)
      .put(`/api/v1/users/${users.collegeStudent.id}`)
      .set(auth('collegeStudent'))
      .send({ preferences: { plan: 'pro', theme: 'dark' } })
      .expect(200);
    expect(cheat.body.data.preferences.theme).toBe('dark');
    expect(cheat.body.data.preferences.plan).toBeUndefined();
  });
});
