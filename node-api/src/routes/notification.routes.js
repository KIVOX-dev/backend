const express = require('express');
const controller = require('../controllers/notification.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/notification.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.list); // always the caller's own notifications
router.patch('/:id/read', controller.markRead);
router.post(
  '/',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.HR),
  validate(schema.create),
  controller.create
);

module.exports = router;
