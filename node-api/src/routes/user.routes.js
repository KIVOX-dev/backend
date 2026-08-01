const express = require('express');
const controller = require('../controllers/user.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const scopeInstitution = require('../middlewares/scopeInstitution');
const schema = require('../validations/user.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate, scopeInstitution);

// Must come before GET '/:id' — same route-ordering hazard flagged in the
// audit for python-service's students.py (/pending vs /{student_id}).
router.get('/pending', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.listPending);

router.get('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.list);
router.get('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.getById);

// Faculty may create student accounts only — enforced in user.service.js#create,
// not just at the route gate, since faculty's access is role-conditional, not blanket.
router.post(
  '/',
  authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.FACULTY),
  validate(schema.create),
  controller.create
);

// institution_admin may review pending users in their own institution — see
// user.service.js#assertCanReview for the actual scoping/role check.
router.put('/:id/approve', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.approve);
router.put('/:id/reject', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.reject);

// No role gate here — self-service updates (a user editing their own
// account, e.g. the student "Upgrade to Pro" flow) are a valid caller too;
// see user.service.js#update for the actual authorization (admin-on-anyone
// within their institution, or anyone-on-themselves with a restricted field
// whitelist).
router.put('/:id', validate(schema.update), controller.update);
router.delete('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.remove);

module.exports = router;
