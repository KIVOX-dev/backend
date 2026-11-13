const express = require('express');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const { paymentLimiter } = require('../middlewares/rateLimiter');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const { ROLES } = require('../config/constants');
const paymentService = require('../services/payment.service');
const schema = require('../validations/payment.validation');

const router = express.Router();

// Independent learners and HR only. Institution admins, faculty and super admins are refused here;
// students who belong to a college are refused inside the service (it needs their database row).
router.use(authenticate, authorize(ROLES.STUDENT, ROLES.HR));

router.get('/plans', (req, res) => ApiResponse.ok(res, paymentService.listPlans()));

router.post(
  '/create-order',
  paymentLimiter,
  validate(schema.createOrder),
  asyncHandler(async (req, res) => {
    const order = await paymentService.createOrder(req.body.plan_id, req.user);
    ApiResponse.created(res, order, 'Order created');
  })
);

router.post(
  '/verify',
  paymentLimiter,
  validate(schema.verify),
  asyncHandler(async (req, res) => {
    const result = await paymentService.verify(req.body, req.user);
    ApiResponse.ok(res, result, 'Payment verified');
  })
);

module.exports = router;
