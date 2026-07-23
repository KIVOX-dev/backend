const express = require('express');
const controller = require('../controllers/resumeBuilder.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/resumeBuilder.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

router.get('/me', authorize(ROLES.STUDENT), controller.getOwn);
router.put('/me', authorize(ROLES.STUDENT), validate(schema.save), controller.saveOwn);

router.get('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.HR), controller.list);
router.get('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.HR), controller.getById);

module.exports = router;
