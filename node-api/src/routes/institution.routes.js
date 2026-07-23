const express = require('express');
const controller = require('../controllers/institution.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/institution.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

router.get('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.list);
router.get('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.getById);
router.post('/', authorize(ROLES.SUPER_ADMIN), validate(schema.create), controller.create);
router.put('/:id', authorize(ROLES.SUPER_ADMIN), validate(schema.update), controller.update);
router.delete('/:id', authorize(ROLES.SUPER_ADMIN), controller.remove);

module.exports = router;
