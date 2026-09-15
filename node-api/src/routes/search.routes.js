const express = require('express');
const controller = require('../controllers/search.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const { ROLES } = require('../config/constants');

const router = express.Router();

// Same audience as the shell that surfaces this ("Search users, placements,
// or drives..." — CollegeAdminShell.tsx, institution admin console). Faculty
// share that console's search bar in the live frontend, so they're included
// here too — students/hr have their own, differently-scoped search bars
// covered separately, not this endpoint.
router.get('/', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY), controller.search);

module.exports = router;
