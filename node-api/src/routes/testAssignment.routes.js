const express = require('express');
const controller = require('../controllers/testAssignment.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/testAssignment.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY), validate(schema.create), controller.create);
router.put('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY), validate(schema.update), controller.update);

module.exports = router;
