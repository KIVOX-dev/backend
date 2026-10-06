const express = require('express');
const controller = require('../controllers/ai.controller');
const authenticate = require('../middlewares/authenticate');
const validate = require('../middlewares/validate');
const { aiLimiter, aiInstitutionLimiter } = require('../middlewares/rateLimiter');
const schema = require('../validations/ai.validation');

const router = express.Router();
router.use(authenticate);

router.post('/resume/improve', aiLimiter, aiInstitutionLimiter, validate(schema.improveResume), controller.improveResume);

// Explanations for the practice results screen. Mostly cache hits after the
// first student sees a question, so it shares the AI limiters but costs little.
router.post('/explain-questions', aiLimiter, aiInstitutionLimiter, validate(schema.explainQuestions), controller.explainQuestions);

module.exports = router;
