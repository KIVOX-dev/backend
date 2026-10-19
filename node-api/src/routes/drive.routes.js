const express = require('express');
const controller = require('../controllers/drive.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/drive.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

// Same staff who can shortlist for a drive (institution_admin, faculty,
// super_admin) can define its rounds and see/resend its notification emails.
const STAFF = [ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY];

router.get('/:id/notifications', authorize(...STAFF), controller.getNotifications);
router.post('/:id/notifications/resend-failed', authorize(...STAFF), controller.resendFailedNotifications);
router.get('/:id/rounds', authorize(...STAFF), controller.listRounds);
router.put('/:id/rounds/:roundNumber', authorize(...STAFF), validate(schema.round), controller.upsertRound);

module.exports = router;
