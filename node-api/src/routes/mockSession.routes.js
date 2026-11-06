const express = require('express');
const controller = require('../controllers/mockSession.controller');
const authenticate = require('../middlewares/authenticate');
const validate = require('../middlewares/validate');
const ApiError = require('../utils/ApiError');
const schema = require('../validations/mockSession.validation');
const { ttsLimiter } = require('../middlewares/rateLimiter');

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
// Static path must be registered before '/:id'.
router.get('/gd/topics', validate(schema.gdTopicsQuery, 'query'), controller.gdTopics);
router.get('/:id', controller.get);
// GD turn endpoints fire many times per session (one per bot line), so they use the looser
// per-user voice limiter, not the 20/15min AI limiter.
router.post('/:id/gd/turn', ttsLimiter, validate(schema.gdNextTurn), controller.gdNextTurn);
router.post('/:id/gd/interrupt-check', ttsLimiter, validate(schema.gdInterruptCheck), controller.gdInterruptCheck);
router.post('/:id/rounds/:round', validateRound, controller.submitRound);
router.post('/:id/abandon', controller.abandon);

module.exports = router;
