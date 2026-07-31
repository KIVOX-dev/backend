const express = require('express');
const controller = require('../controllers/placementApplication.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const scopeInstitution = require('../middlewares/scopeInstitution');
const validate = require('../middlewares/validate');
const schema = require('../validations/placementApplication.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);
router.use(scopeInstitution);

// HR excluded from list/getById: HR has no institutionId and should use
// /placements/applications/me instead, not the generic institution-scoped list.
router.get('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.STUDENT), controller.list);
router.get('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.STUDENT), controller.getById);
router.post('/', authorize(ROLES.STUDENT), validate(schema.create), controller.create);
router.patch(
  '/:id/status',
  authorize(ROLES.STUDENT, ROLES.HR, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.SUPER_ADMIN),
  validate(schema.updateStatus),
  controller.updateStatus
);

module.exports = router;
