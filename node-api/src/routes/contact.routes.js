const express = require('express');
const contactController = require('../controllers/contact.controller');
const validate = require('../middlewares/validate');
const verifyTurnstile = require('../middlewares/verifyTurnstile');
const { authLimiter } = require('../middlewares/rateLimiter');
const schema = require('../validations/contact.validation');

const router = express.Router();

// Public and unauthenticated, so it gets the same abuse protection as signup:
// authLimiter's tight per-IP budget plus a Turnstile check.
router.post(
  '/sales',
  authLimiter,
  validate(schema.salesRequest),
  verifyTurnstile('talk_to_sales'),
  contactController.salesRequest
);

module.exports = router;
