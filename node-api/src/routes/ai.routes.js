const express = require('express');
const controller = require('../controllers/ai.controller');
const authenticate = require('../middlewares/authenticate');
const validate = require('../middlewares/validate');
const schema = require('../validations/ai.validation');

const router = express.Router();
router.use(authenticate);

router.post('/resume/improve', validate(schema.improveResume), controller.improveResume);

module.exports = router;
