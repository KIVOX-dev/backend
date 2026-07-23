const express = require('express');
const controller = require('../controllers/placementApplication.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/placementApplication.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', authorize(ROLES.STUDENT), validate(schema.create), controller.create);
router.patch(
  '/:id/status',
  authorize(ROLES.STUDENT, ROLES.HR, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.SUPER_ADMIN),
  validate(schema.updateStatus),
  controller.updateStatus
);

module.exports = router;
