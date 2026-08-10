const express = require('express');
const controller = require('../controllers/test.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const scopeInstitution = require('../middlewares/scopeInstitution');
const { aiLimiter, aiInstitutionLimiter } = require('../middlewares/rateLimiter');
const schema = require('../validations/test.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate, scopeInstitution);

// FACULTY's only permitted touchpoint with this module is viewing student
// results (getResults/collegeResults below) — no authoring, and no browsing
// the assessment catalog itself (list/getById/overview stats).
//
// Static-segment routes before GET '/:id' — same route-ordering hazard
// flagged in the audit for python-service's students.py.
router.post(
  '/generate-questions',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN),
  aiLimiter,
  aiInstitutionLimiter,
  validate(schema.generateQuestions),
  controller.generateQuestions
);
router.get('/overview/stats', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.STUDENT), controller.overviewStats);
router.get('/college/results', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY), controller.collegeResults); // must precede '/:id/results' — same {segment}/results shape
router.post('/submit', validate(schema.submit), controller.submitAttempt);

router.get('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.STUDENT), controller.list);
router.get('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.STUDENT), controller.getById);
router.get('/:id/results', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY), controller.getResults);
router.post('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), validate(schema.create), controller.create);
router.put('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), validate(schema.update), controller.update);
// python-service's delete_assessment had no role restriction at all beyond
// institution scope (any authenticated user, including students, could
// delete any in-scope assessment) — not carried forward, kept at node-api's
// existing stricter default instead.
router.delete('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.remove);

module.exports = router;
