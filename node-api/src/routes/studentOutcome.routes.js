const express = require('express');
const controller = require('../controllers/studentOutcome.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const { documentUpload, verifyDocument } = require('../middlewares/upload');
const schema = require('../validations/studentOutcome.validation');
const { ROLES } = require('../config/constants');

// Higher-study admissions and competitive-exam results. Role-gated inside the
// service: a student touches only their own, staff only their institution's.
const router = express.Router();
router.use(authenticate);

router.get('/student/:studentId', controller.listForStudent);
router.get('/:id/proof-url', controller.getProofUrl);

// documentUpload.any() is a no-op on a plain JSON request (the document is
// optional) — see placementRecord.routes.js's identical comment.
router.post('/', documentUpload.any(), verifyDocument, validate(schema.create), controller.create);
router.put('/:id/proof', documentUpload.any(), verifyDocument, controller.attachProof);

router.put(
  '/:id/verify',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN),
  validate(schema.verify),
  controller.verify
);

// Deletes the record and its document. Admin-only, like placement records:
// nothing else removes a stored document.
router.delete('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.remove);

module.exports = router;
