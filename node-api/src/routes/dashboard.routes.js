const express = require('express');
const controller = require('../controllers/dashboard.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

router.get('/student/:studentId', controller.student); // no role restriction, matches python-service's version
router.get('/admin', authorize(ROLES.FACULTY, ROLES.INSTITUTION_ADMIN, ROLES.SUPER_ADMIN), controller.admin);
router.get('/super', authorize(ROLES.SUPER_ADMIN), controller.super);

module.exports = router;
