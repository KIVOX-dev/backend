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

const evaluate = Joi.object({
  role: Joi.string().max(255).default('general'),
  answers: Joi.array()
    .items(
      Joi.object({
        question_id: Joi.number().integer().required(),
        question: Joi.string().max(2000).required(),
        expected_answer: Joi.string().max(4000).allow('').default(''),
        answer: Joi.string().max(8000).allow('').default(''),
      })
    )
    .min(1)
    .max(20)
    .required(),
});

module.exports = { generate, generateMcq, evaluate, INTERVIEW_ROUNDS };
