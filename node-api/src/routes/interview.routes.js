const express = require('express');
const controller = require('../controllers/interview.controller');
const authenticate = require('../middlewares/authenticate');
const validate = require('../middlewares/validate');
const schema = require('../validations/interview.validation');

const router = express.Router();
router.use(authenticate);

// role/company are query params here, matching python-service's function
// signature (plain args, not a request-body model, become query params
// under FastAPI's inference rules).
router.post('/generate', validate(schema.generate, 'query'), controller.generate);

module.exports = router;
