const express = require('express');

const router = express.Router();

router.use('/auth', require('./authRoutes'));
router.use('/users', require('./user.routes'));
router.use('/institutions', require('./institution.routes'));
router.use('/departments', require('./department.routes'));
router.use('/college-admins', require('./collegeAdmin.routes'));
router.use('/companies', require('./company.routes'));
router.use('/hr', require('./hr.routes'));
router.use('/faculty', require('./faculty.routes'));
router.use('/students', require('./student.routes'));
router.use('/placements', require('./placement.routes'));
router.use('/placement-applications', require('./placementApplication.routes'));
router.use('/tests', require('./test.routes'));
router.use('/test-assignments', require('./testAssignment.routes'));
router.use('/results', require('./result.routes'));
router.use('/notifications', require('./notification.routes'));
router.use('/resume-builder', require('./resumeBuilder.routes'));
router.use('/activity-logs', require('./activityLog.routes'));

module.exports = router;
