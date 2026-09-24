const Joi = require('joi');

const INTERVIEW_ROUNDS = ['technical', 'system_design', 'hr', 'behavioral', 'managerial', 'aptitude'];

const generate = Joi.object({
  role: Joi.string().min(1).max(255).required(),
  company: Joi.string().max(255),
  round: Joi.string().valid(...INTERVIEW_ROUNDS).default('technical'),
});

module.exports = { generate, INTERVIEW_ROUNDS };
