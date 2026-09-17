const express = require('express');
const controller = require('../controllers/certificateVerification.controller');
const { apiLimiter } = require('../middlewares/rateLimiter');

// Deliberately unauthenticated — a certificate is only useful as a
// credential if anyone holding its link (a recruiter clicking LinkedIn's
// "Show credential" button, e.g.) can verify it without a TalentSnaps
// account. See studentSkill.service.js#verifyCertificate.
const router = express.Router();
router.get('/:id/verify', apiLimiter, controller.verify);

module.exports = router;
