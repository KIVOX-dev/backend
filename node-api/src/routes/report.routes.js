const express = require('express');
const controller = require('../controllers/report.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/report.validation');
const { ROLES } = require('../config/constants');

// Reports & Compliance — NIRF/NAAC/NBA, higher-study, exam, offer-letter and
// audit data for an institution's admins. Faculty, HR and students get none
// of it.
const router = express.Router();
router.use(authenticate, authorize(ROLES.INSTITUTION_ADMIN, ROLES.SUPER_ADMIN));

const filtered = validate(schema.filters, 'query');

router.get('/nirf', filtered, controller.nirf);
router.get('/nba', filtered, controller.nba);
router.get('/naac', filtered, controller.naac);
router.get('/higher-studies', filtered, controller.higherStudies);
router.get('/competitive-exams', filtered, controller.competitiveExams);
router.get('/offer-letters', filtered, controller.offerLetters);
router.post('/offer-letters/remind', filtered, controller.remindOfferLetters);
router.get('/students', filtered, controller.studentOptions);
router.get('/audit-log', validate(schema.auditLog, 'query'), controller.auditLog);

module.exports = router;
