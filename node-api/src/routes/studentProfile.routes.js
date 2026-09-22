const express = require('express');
const controller = require('../controllers/studentProfile.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/studentProfile.validation');
const { ROLES } = require('../config/constants');
const { upload, verifyAndUploadToGcs } = require('../middlewares/upload');

// Mounted at /students/profile in routes/index.js, registered BEFORE the
// general /students router so this more specific prefix is matched first —
// Express resolves overlapping router prefixes by registration order, not
// specificity. Deliberately does not use scopeInstitution (see
// studentProfile.service.js for why).
const router = express.Router();
router.use(authenticate, authorize(ROLES.STUDENT));

router.get('/', controller.getOwn);
router.get('/summary', controller.getSummary);
router.get('/practice-trends', controller.getPracticeTrends);
router.get('/leetcode-stats', controller.getLeetcodeStats);
router.get('/hackerrank-stats', controller.getHackerrankStats);
router.get('/skill-badges', controller.getSkillBadges);
router.get('/certificates', controller.getCertificates);
router.post('/', validate(schema.create), controller.createOwn);
router.put('/', validate(schema.update), controller.updateOwn);
router.post('/avatar', upload.any(), verifyAndUploadToGcs, controller.uploadAvatar);
router.post('/cover', upload.any(), verifyAndUploadToGcs, controller.uploadCoverImage);

module.exports = router;
