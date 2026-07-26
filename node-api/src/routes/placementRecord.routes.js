const express = require('express');
const controller = require('../controllers/placementRecord.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/placementRecord.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.list); // every role browses placements scoped to their own institution
router.get('/student/:studentId', controller.listForStudent);
router.get('/:id', controller.getById);

router.post('/', validate(schema.create), controller.create); // role-gated inside the service (student=self, staff=on behalf of)

router.put(
  '/:id/verify',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN),
  validate(schema.verify),
  controller.verify
);

module.exports = router;
