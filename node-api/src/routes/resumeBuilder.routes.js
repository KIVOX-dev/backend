const express = require('express');
const controller = require('../controllers/resumeBuilder.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/resumeBuilder.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

// Mirrors python-service's resume.py paths exactly (GET/POST '/', not
// '/me') — this is what the live frontend actually calls today.
router.get('/', authorize(ROLES.STUDENT), controller.getOwn);
router.post('/', authorize(ROLES.STUDENT), validate(schema.save), controller.saveOwn);

router.post('/version', authorize(ROLES.STUDENT), validate(schema.saveVersion), controller.addVersion);
router.post('/version/:versionId/restore', authorize(ROLES.STUDENT), controller.restoreVersion);
router.delete('/version/:versionId', authorize(ROLES.STUDENT), controller.deleteVersion);

router.post('/analyze', authorize(ROLES.STUDENT), controller.analyze);
router.post('/match-jd', authorize(ROLES.STUDENT), validate(schema.matchJd), controller.matchJobDescription);
router.post('/ai-suggest', authorize(ROLES.STUDENT), validate(schema.aiSuggest), controller.aiSuggest);

// Any authenticated role, not student-only — but DOES require auth, unlike
// python-service's version of this endpoint (see resumeBuilder.service.js
// #parseResumeText for why that was tightened rather than carried forward).
router.post('/parse', validate(schema.parse), controller.parseResumeText);

// Staff view of any student's resume — python-service has no equivalent of
// this (it never had a cross-student resume listing endpoint); kept at a
// distinct sub-path specifically to avoid colliding with GET '/' above,
// which now means "my own resume" to match python's actual path shape.
router.get('/all', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.HR), controller.list);
router.get('/all/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY, ROLES.HR), controller.getById);

module.exports = router;
