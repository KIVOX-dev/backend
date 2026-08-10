const express = require('express');
const controller = require('../controllers/dashboard.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

// Ownership enforced in dashboard.service.js#studentDashboard via canActOnStudent()
// (owner, institution admin/faculty, or super_admin) — same gate every other
// per-student endpoint in student.service.js uses. No role restriction here on
// purpose: a student viewing their own dashboard is legitimate, so the check has
// to happen after the student record is loaded, not before, at the route level.
router.get('/student/:studentId', controller.student);
router.get('/admin', authorize(ROLES.FACULTY, ROLES.INSTITUTION_ADMIN, ROLES.SUPER_ADMIN), controller.admin);
router.get('/super', authorize(ROLES.SUPER_ADMIN), controller.super);

module.exports = router;
