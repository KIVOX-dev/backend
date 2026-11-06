const express = require('express');
const Joi = require('joi');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');
const validate = require('../middlewares/validate');
const { ttsLimiter } = require('../middlewares/rateLimiter');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');
const tts = require('../services/tts.service');

const router = express.Router();
router.use(authenticate, authorize(ROLES.STUDENT));

const schema = Joi.object({
  voice: Joi.string().valid(...tts.SLOTS).required(),
  text: Joi.string().min(1).max(tts.MAX_CHARS).required(),
});

// Returns raw audio/mpeg. Private cache: audio is per-voice speech, not shared across users by URL.
router.post(
  '/',
  ttsLimiter,
  validate(schema),
  asyncHandler(async (req, res) => {
    const audio = await tts.synthesize(req.body.voice, req.body.text);
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400', 'Content-Length': audio.length });
    res.send(audio);
  })
);

module.exports = router;
