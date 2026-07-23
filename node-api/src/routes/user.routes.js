const express = require('express');
const controller = require('../controllers/user.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const scopeInstitution = require('../middlewares/scopeInstitution');
const schema = require('../validations/user.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), scopeInstitution);

router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', validate(schema.create), controller.create);
router.put('/:id', validate(schema.update), controller.update);
router.delete('/:id', authorize(ROLES.SUPER_ADMIN), controller.remove);

module.exports = router;
