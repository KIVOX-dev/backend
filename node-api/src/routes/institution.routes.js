const express = require('express');
const controller = require('../controllers/institution.controller');
const departmentController = require('../controllers/department.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/institution.validation');
const { ROLES } = require('../config/constants');

const router = express.Router();

// Public, no auth (ported from python-service's GET /colleges) — registered
// before router.use(authenticate) below so it deliberately bypasses it.
// Used by registration flows to populate an institution picker.
router.get('/public', controller.publicList);

// Also public, same reasoning — backs the College -> Department dropdown on
// student profile completion. Must work for any college a student picks,
// not just one they're already scoped to (they may not have one set yet).
router.get('/:id/departments', departmentController.listByInstitution);

router.use(authenticate);

// Must come before GET '/:id' — otherwise Express would match "me" as an :id
// value instead of this route.
router.get('/me', controller.getOwn);

router.get('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.list);
router.get('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN), controller.getById);
router.post('/', authorize(ROLES.SUPER_ADMIN), validate(schema.create), controller.create);
router.put('/:id', authorize(ROLES.SUPER_ADMIN), validate(schema.update), controller.update);
router.delete('/:id', authorize(ROLES.SUPER_ADMIN), controller.remove);

module.exports = router;
