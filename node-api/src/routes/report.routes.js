const express = require('express');
const controller = require('../controllers/report.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/report.validation');
const { ROLES } = require('../config/constants');

// Reports & Compliance — NIRF/offer-letter/audit data for an institution's
// admins. Faculty, HR and students get none of it.
const router = express.Router();
router.use(authenticate, authorize(ROLES.INSTITUTION_ADMIN, ROLES.SUPER_ADMIN));

router.get('/nirf', validate(schema.filters, 'query'), controller.nirf);
router.get('/offer-letters', validate(schema.filters, 'query'), controller.offerLetters);
router.post('/offer-letters/remind', validate(schema.filters, 'query'), controller.remindOfferLetters);
router.get('/audit-log', validate(schema.auditLog, 'query'), controller.auditLog);

module.exports = router;
