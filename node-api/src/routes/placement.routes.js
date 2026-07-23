const express = require('express');
const controller = require('../controllers/placement.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/placement.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.list); // every role can browse placements relevant to them
router.get('/:id', controller.getById);
router.post(
  '/',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.HR),
  validate(schema.create),
  controller.create
);
router.put(
  '/:id',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.HR),
  validate(schema.update),
  controller.update
);
router.delete('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.remove);

module.exports = router;
