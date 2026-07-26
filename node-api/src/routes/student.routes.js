const express = require('express');
const controller = require('../controllers/student.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const scopeInstitution = require('../middlewares/scopeInstitution');
const schema = require('../validations/student.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();

// Unauthenticated on purpose — ported from python-service's POST
// /students/identify, used by check-in kiosks that have no login. Registered
// before router.use(authenticate) below so it deliberately bypasses it. See
// student.service.js#identify for the accepted-tradeoff note.
router.post('/identify', validate(schema.identify), controller.identify);

router.use(authenticate, scopeInstitution);

// Static-segment routes before GET '/:id' — same route-ordering hazard
// flagged in the audit for python-service's students.py itself (/pending
// vs /{student_id}).
router.get('/pending', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.listPending);
router.post(
  '/batch',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY),
  validate(schema.batchCreate),
  controller.batchCreate
);

router.get('/', controller.list); // confined to caller's own institution unless super_admin
router.get('/:id', controller.getById);
router.get('/:id/dashboard', controller.dashboard);
router.get('/:id/tests/analytics', controller.testAnalytics);
router.get('/:id/tests', controller.listTests);
router.post('/:id/tests', validate(schema.logTest), controller.logTest);
router.get('/:id/interviews', controller.listInterviews);
router.post('/:id/interviews', validate(schema.logInterview), controller.logInterview);
router.get('/:id/achievements', controller.listAchievements);
// python-service's /achievements/evaluate had no auth dependency at all —
// this router's blanket router.use(authenticate) above already closes that
// gap without needing a special case here.
router.post('/:id/achievements/evaluate', controller.evaluateAchievements);

router.post(
  '/',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY),
  validate(schema.create),
  controller.create
);
router.put(
  '/:id',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY),
  validate(schema.update),
  controller.update
);
router.delete('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.remove);

module.exports = router;
