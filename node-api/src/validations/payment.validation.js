const Joi = require('joi');
const { PLAN_IDS } = require('../config/plans');

// Only a plan id comes from the client; the amount is looked up server-side.
const createOrder = Joi.object({
  plan_id: Joi.string().valid(...PLAN_IDS).required(),
});

const verify = Joi.object({
  razorpay_order_id: Joi.string().max(100).required(),
  razorpay_payment_id: Joi.string().max(100).required(),
  razorpay_signature: Joi.string().max(200).required(),
});

module.exports = { createOrder, verify };
