const Joi = require('joi');

const INTERVIEW_ROUNDS = ['technical', 'system_design', 'hr', 'behavioral', 'managerial', 'aptitude'];

const generate = Joi.object({
  role: Joi.string().min(1).max(255).required(),
  company: Joi.string().max(255),
  round: Joi.string().valid(...INTERVIEW_ROUNDS).default('technical'),
});

const generateMcq = Joi.object({
  role: Joi.string().min(1).max(255).required(),
  company: Joi.string().max(255),
  count: Joi.number().integer().min(5).max(30).default(20),
});

module.exports = { generate, generateMcq, INTERVIEW_ROUNDS };
