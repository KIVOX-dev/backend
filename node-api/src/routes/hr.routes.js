const express = require('express');
const controller = require('../controllers/hr.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/hr.validation');
const portalRoutes = require('./hrPortal.routes');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

// HR portal features (pipeline, interviews, evaluation, matching, talent pool,
// analytics, dashboard, employees). Mounted per-prefix, before the legacy
// '/:id' CRUD below, so (a) the static segments are never read as an :id and
// (b) the HR-only guard applies to these prefixes alone — it must not leak
// onto the institution_admin-readable GET '/' and '/:id'.
const PORTAL_PREFIXES = ['/dashboard', '/analytics', '/applications', '/pipeline', '/interviews', '/evaluations', '/matching', '/talent-pool', '/employees'];
router.use(PORTAL_PREFIXES, authorize(ROLES.SUPER_ADMIN, ROLES.HR));
router.use(portalRoutes);

router.get('/', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.HR), controller.list);
router.get('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN, ROLES.HR), controller.getById);
router.post('/', authorize(ROLES.SUPER_ADMIN), validate(schema.create), controller.create);
router.put('/:id', authorize(ROLES.SUPER_ADMIN), validate(schema.update), controller.update);
router.delete('/:id', authorize(ROLES.SUPER_ADMIN), controller.remove);

module.exports = router;
