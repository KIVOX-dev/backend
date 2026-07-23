const express = require('express');
const controller = require('../controllers/activityLog.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate, authorize(ROLES.SUPER_ADMIN));

router.get('/', controller.list);
router.get('/:id', controller.getById);

module.exports = router;
