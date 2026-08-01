const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/institutions', require('./institution.routes'));
router.use('/departments', require('./department.routes'));
router.use('/college-admins', require('./collegeAdmin.routes'));
router.use('/companies', require('./company.routes'));
router.use('/hr', require('./hr.routes'));
router.use('/faculty', require('./faculty.routes'));
// Registered before /students — more specific prefix must win, and Express
// resolves overlapping router prefixes by registration order, not by
// specificity.
router.use('/students/profile', require('./studentProfile.routes'));
router.use('/students', require('./student.routes'));
router.use('/placements', require('./placement.routes'));
// Alias for the live frontend's HR module, which still calls /jobs (its
// original python-service path) rather than /placements — same router
// instance, so /me, /drives, /applications/me and CRUD all work identically
// under both prefixes with zero duplicated controller/service logic.
router.use('/jobs', require('./placement.routes'));
router.use('/placement-applications', require('./placementApplication.routes'));
router.use('/tests', require('./test.routes'));
router.use('/test-assignments', require('./testAssignment.routes'));
router.use('/results', require('./result.routes'));
router.use('/notifications', require('./notification.routes'));
router.use('/resume', require('./resumeBuilder.routes')); // matches python-service's /resume path (file kept as resumeBuilder for history)
router.use('/activity-logs', require('./activityLog.routes'));
router.use('/user-data', require('./userData.routes'));
router.use('/placement-records', require('./placementRecord.routes'));
router.use('/profile', require('./profile.routes'));
router.use('/ai', require('./ai.routes'));
router.use('/interviews', require('./interview.routes'));
router.use('/leaderboard', require('./leaderboard.routes'));
router.use('/dashboard', require('./dashboard.routes'));
router.use('/batches', require('./batch.routes'));
router.use('/chat', require('./chat.routes'));

module.exports = router;
