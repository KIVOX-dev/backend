const express = require('express');
const controller = require('../controllers/placement.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const { upload, verifyAndUploadLogo } = require('../middlewares/upload');
const schema = require('../validations/placement.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

// Static-segment routes must come before GET '/:id' — same route-ordering
// hazard flagged in the audit for python-service's students.py.
router.get('/me', authorize(ROLES.HR, ROLES.SUPER_ADMIN), controller.listMine);
router.get('/drives', controller.listDrives); // institution-scoped inside the service
router.get('/applications/me', authorize(ROLES.HR, ROLES.SUPER_ADMIN), controller.listApplicationsForRecruiter);

// Company logo for a vacancy: upload first, then send the returned logo_ref as
// company_logo_url when creating/updating the posting. Static segment, so it
// sits before '/:id'.
router.post(
  '/logo',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.HR),
  upload.any(),
  verifyAndUploadLogo,
  controller.uploadLogo
);

router.get('/', controller.listWithActor); // every role can browse placements relevant to them (institution-scoped, see placement.service.js#list)
router.get('/:id', controller.getById);
router.post(
  '/',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.HR),
  validate(schema.create),
  controller.create
);
router.put(
  '/:id',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.HR),
  validate(schema.update),
  controller.update
);
router.delete('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.remove);

module.exports = router;
