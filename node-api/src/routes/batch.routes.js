const express = require('express');
const controller = require('../controllers/batch.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/batch.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

router.post(
  '/',
  authorize(ROLES.FACULTY, ROLES.INSTITUTION_ADMIN, ROLES.SUPER_ADMIN),
  validate(schema.create),
  controller.create
);
router.get('/history', controller.history);
router.get('/students', controller.listStudents);
router.get('/pending', controller.pending); // active batches — see batch.service.js#pending
router.put('/:id/status', validate(schema.updateStatus), controller.updateStatus);

module.exports = router;
