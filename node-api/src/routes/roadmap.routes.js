const express = require('express');
const controller = require('../controllers/roadmap.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const { roadmapLimiter } = require('../middlewares/rateLimiter');
const schema = require('../validations/roadmap.validation');
const { ROLES } = require('../config/constants');

// "Choose Your Job Role" (Setup) and the YouTube-to-Course roadmap tab — see
// config/jobRoleCatalog.js for the fixed role list and
// services/roadmap.service.js for how the per-skill video cache and role
// certificates work. Self-service like /students/profile and /courses: every
// call is scoped to the authenticated student alone.
const router = express.Router();
router.use(authenticate, authorize(ROLES.STUDENT));

router.get('/roles', controller.listRoles);
router.get('/roles/:roleId', roadmapLimiter, controller.getRoadmap);
router.put('/target-role', validate(schema.targetRole), controller.chooseTargetRole);

module.exports = router;
