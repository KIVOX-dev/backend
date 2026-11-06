const express = require('express');
const controller = require('../controllers/mockSession.controller');
const authenticate = require('../middlewares/authenticate');
const validate = require('../middlewares/validate');
const ApiError = require('../utils/ApiError');
const schema = require('../validations/mockSession.validation');

const router = express.Router();
router.use(authenticate);

// Picks the per-round body schema from :round (1-3) before the generic validator runs.
const validateRound = (req, res, next) => {
  const roundSchema = schema.submitRound[req.params.round];
  if (!roundSchema) return next(ApiError.badRequest('round must be 1, 2 or 3'));
  return validate(roundSchema)(req, res, next);
};

router.post('/', validate(schema.createSession), controller.create);
router.get('/', controller.list);
router.get('/:id', controller.get);
router.post('/:id/rounds/:round', validateRound, controller.submitRound);
router.post('/:id/abandon', controller.abandon);

module.exports = router;
