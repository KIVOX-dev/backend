const express = require('express');
const controller = require('../controllers/profile.controller');
const authenticate = require('../middlewares/authenticate');
const { upload, verifyAndPersist } = require('../middlewares/upload');
const { validateProfileValues } = require('../validations/profile.validation');

const router = express.Router();
router.use(authenticate);

router.get('/schema', controller.getSchema);
router.get('/me', controller.getOwn);

// upload.any() is a no-op on non-multipart requests (see middlewares/upload.js)
// — it correctly falls through to req.body already parsed by express.json()
// for a plain JSON save, and parses text+file fields for a multipart one.
// validateProfileValues whitelists req.body against the caller's own portal
// schema (config/onboardingSchemas.js) and rejects unknown fields — see
// validations/profile.validation.js for why this can't be the usual static
// validate(schema) middleware. Runs after upload.any() so req.body is
// populated for both JSON and multipart submissions.
router.post('/', upload.any(), verifyAndPersist, validateProfileValues, controller.saveOwn);
router.put('/', upload.any(), verifyAndPersist, validateProfileValues, controller.saveOwn);

module.exports = router;
