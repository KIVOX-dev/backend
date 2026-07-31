const express = require('express');
const controller = require('../controllers/result.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const scopeInstitution = require('../middlewares/scopeInstitution');
const validate = require('../middlewares/validate');
const schema = require('../validations/result.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);
router.use(scopeInstitution);

// HR excluded: HR has no institutionId, and the real per-entity filtering
// lives in result.service.js — HR has no legitimate use case here.
router.get('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.STUDENT), controller.list);
router.get('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.STUDENT), controller.getById);
router.post('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY), validate(schema.create), controller.create);

module.exports = router;
