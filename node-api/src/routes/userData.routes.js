const express = require('express');
const controller = require('../controllers/userData.controller');
const authenticate = require('../middlewares/authenticate');
const validate = require('../middlewares/validate');
const schema = require('../validations/userData.validation');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.getOwn);
router.post('/', validate(schema.save), controller.saveOwn);

module.exports = router;
