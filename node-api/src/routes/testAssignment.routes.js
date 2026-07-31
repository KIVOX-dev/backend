const express = require('express');
const controller = require('../controllers/testAssignment.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const scopeInstitution = require('../middlewares/scopeInstitution');
const validate = require('../middlewares/validate');
const schema = require('../validations/testAssignment.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);
router.use(scopeInstitution);

// FACULTY excluded everywhere on this router: their only permitted touchpoint
// with the assessment module is viewing student *results*, which lives on
// GET /tests/:id/results and /tests/college/results, not here — assignment
// tracking/authoring is institution_admin (+ super_admin) and the student
// themself only. HR also excluded: HR has no institutionId, and the real
// per-entity filtering lives in testAssignment.service.js.
router.get('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.STUDENT), controller.list);
router.get('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.STUDENT), controller.getById);
router.get('/:id/questions', authorize(ROLES.STUDENT), controller.getQuestions);
router.post('/:id/submit', authorize(ROLES.STUDENT), validate(schema.submit), controller.submit);
router.post('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), validate(schema.create), controller.create);
router.put('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), validate(schema.update), controller.update);

module.exports = router;
