const express = require('express');
const controller = require('../controllers/studentProfile.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const schema = require('../validations/studentProfile.validation');
const { ROLES } = require('../config/constants');

// Mounted at /students/profile in routes/index.js, registered BEFORE the
// general /students router so this more specific prefix is matched first —
// Express resolves overlapping router prefixes by registration order, not
// specificity. Deliberately does not use scopeInstitution (see
// studentProfile.service.js for why).
const router = express.Router();
router.use(authenticate, authorize(ROLES.STUDENT));

router.get('/', controller.getOwn);
router.post('/', validate(schema.create), controller.createOwn);
router.put('/', validate(schema.update), controller.updateOwn);

module.exports = router;
