const express = require('express');
const controller = require('../controllers/faculty.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const scopeInstitution = require('../middlewares/scopeInstitution');
const schema = require('../validations/faculty.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate, scopeInstitution);

router.get('/', controller.list); // confined to caller's own institution unless super_admin
router.get('/:id', controller.getById);
router.post('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), validate(schema.create), controller.create);
router.put('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), validate(schema.update), controller.update);
router.delete('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.remove);

module.exports = router;
