const express = require('express');
const controller = require('../controllers/profile.controller');
const authenticate = require('../middlewares/authenticate');
const { upload } = require('../middlewares/upload');

const router = express.Router();
router.use(authenticate);

router.get('/schema', controller.getSchema);
router.get('/me', controller.getOwn);

// upload.any() is a no-op on non-multipart requests (see middlewares/upload.js)
// — it correctly falls through to req.body already parsed by express.json()
// for a plain JSON save, and parses text+file fields for a multipart one.
// No schema validation of `values` — ported as-is from python-service's
// profile.py, which never validated submitted values against the onboarding
// schema either (the schema is a client-rendering contract only).
router.post('/', upload.any(), controller.saveOwn);
router.put('/', upload.any(), controller.saveOwn);

module.exports = router;
