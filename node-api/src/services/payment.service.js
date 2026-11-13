const crypto = require('crypto');
const Razorpay = require('razorpay');
const env = require('../config/env');
const { ROLES } = require('../config/constants');
const { PLANS, MIN_AMOUNT_PAISE } = require('../config/plans');
const paymentRepository = require('../repositories/payment.repository');
const userRepository = require('../repositories/user.repository');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { securityEvent, EVENTS } = require('../utils/securityLog');

let client = null;
let clientKey = '';

// Built on first use so the API boots without Razorpay keys (the payment
// endpoints answer 503 until they are set). Rebuilt if the key changes.
function getClient() {
  const { keyId, keySecret } = env.razorpay;
  if (!keyId || !keySecret) {
    throw ApiError.serviceUnavailable('Payments are not configured on this server.');
  }
  if (!client || clientKey !== keyId) {
    client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    clientKey = keyId;
  }
  return client;
}

// Paid plans are for independent learners (a student account with no college)
// and HR accounts. A student who belongs to an institution gets access through
// their college, so they can't buy. Read from the database, not the token, so
// a student moved into a college loses it immediately.
async function assertEligible(actor) {
  const user = await userRepository.findById(actor.id);
  if (!user) throw ApiError.unauthorized();
  const independentLearner = user.role === ROLES.STUDENT && !user.institution_id;
  if (user.role !== ROLES.HR && !independentLearner) {
    throw ApiError.forbidden(
      'Paid plans are for independent learners and HR accounts. Institution accounts get access through their college.',
      'PLAN_NOT_AVAILABLE'
    );
  }
  return user;
}

function addMonths(from, months) {
  const result = new Date(from);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

// Buying again before the plan ends adds the new period on top of what is left.
function nextExpiry(user, plan) {
  const current = user.preferences?.plan_expires_at ? new Date(user.preferences.plan_expires_at) : null;
  const base = current && current > new Date() ? current : new Date();
  return addMonths(base, plan.months);
}

function toGatewayError(err, action) {
  const status = err?.statusCode;
  const description = err?.error?.description || err?.message || 'Unknown error';
  logger.error(`Razorpay ${action} failed`, { status, description });
  // Our own keys being rejected is a server setup problem, not the user's
  // session. It must not be a 401: the web app treats 401 as "signed out".
  if (status === 401) {
    return new ApiError(502, 'Payment provider rejected the server credentials.', null, 'PAYMENT_GATEWAY_AUTH');
  }
  return new ApiError(500, 'Could not reach the payment provider. Please try again.', null, 'PAYMENT_GATEWAY_ERROR');
}

function signaturesMatch(expectedHex, receivedHex) {
  const expected = Buffer.from(expectedHex, 'utf8');
  const received = Buffer.from(String(receivedHex), 'utf8');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

class PaymentService {
  listPlans() {
    return Object.values(PLANS).map(({ id, label, months, amountPaise }) => ({
      id, label, months, amount: amountPaise, currency: 'INR',
    }));
  }

  async createOrder(planId, actor) {
    const plan = PLANS[planId];
    if (!plan) throw ApiError.badRequest('Unknown plan');
    if (plan.amountPaise < MIN_AMOUNT_PAISE) throw ApiError.badRequest('Amount is below the minimum');
    await assertEligible(actor);
    const razorpay = getClient();

    const receipt = `ts_${crypto.randomBytes(8).toString('hex')}`;
    let order;
    try {
      order = await razorpay.orders.create({
        amount: plan.amountPaise,
        currency: 'INR',
        receipt,
        notes: { user_id: actor.id, plan_id: plan.id },
      });
    } catch (err) {
      throw toGatewayError(err, 'order creation');
    }

    await paymentRepository.create({
      user_id: actor.id,
      role: actor.role,
      plan_id: plan.id,
      amount: order.amount,
      currency: order.currency,
      receipt,
      razorpay_order_id: order.id,
    });

    return {
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: env.razorpay.keyId,
      plan_id: plan.id,
      plan_label: plan.label,
    };
  }

  async verify({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature }, actor) {
    if (!env.razorpay.keySecret) throw ApiError.serviceUnavailable('Payments are not configured on this server.');
    await assertEligible(actor);

    // The order must be one this user created. Not-found for anyone else's, so ids can't be probed.
    const payment = await paymentRepository.findOne({ razorpay_order_id: orderId });
    if (!payment || payment.user_id !== actor.id) throw ApiError.notFound('Order not found');

    const expected = crypto
      .createHmac('sha256', env.razorpay.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    if (!signaturesMatch(expected, signature)) {
      securityEvent(EVENTS.PAYMENT_VERIFY_FAILED, { actorId: actor.id, orderId });
      throw ApiError.badRequest('Payment verification failed', null, 'PAYMENT_SIGNATURE_MISMATCH');
    }

    const plan = PLANS[payment.plan_id];
    const user = await userRepository.findById(actor.id);
    const expiresAt = nextExpiry(user, plan);

    // Claim the order atomically so a double-click or retry can't add the period twice.
    const claim = await paymentRepository.collection.updateOne(
      { razorpay_order_id: orderId, status: 'created' },
      { $set: { status: 'paid', razorpay_payment_id: paymentId, paid_at: new Date(), plan_expires_at: expiresAt, updated_at: new Date() } }
    );
    if (claim.modifiedCount === 0) {
      const done = await paymentRepository.findOne({ razorpay_order_id: orderId });
      if (done?.status === 'paid' && done.razorpay_payment_id === paymentId) {
        return { verified: true, already_processed: true, plan_id: done.plan_id, plan_expires_at: done.plan_expires_at };
      }
      throw ApiError.conflict('This order was already settled with a different payment.', 'PAYMENT_ORDER_SETTLED');
    }

    try {
      await userRepository.updateById(user.id, {
        preferences: { ...(user.preferences || {}), plan: 'pro', plan_id: plan.id, plan_expires_at: expiresAt.toISOString() },
      });
    } catch (err) {
      // Money is captured but the plan wasn't applied: release the claim so a retry can finish it.
      await paymentRepository.collection.updateOne(
        { razorpay_order_id: orderId },
        { $set: { status: 'created', updated_at: new Date() } }
      );
      throw err;
    }

    securityEvent(EVENTS.PAYMENT_COMPLETED, { actorId: actor.id, orderId, planId: plan.id, amount: payment.amount });
    return { verified: true, already_processed: false, plan_id: plan.id, plan_expires_at: expiresAt };
  }
}

module.exports = new PaymentService();
