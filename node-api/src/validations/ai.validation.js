const Joi = require('joi');

const improveResume = Joi.object({
  objective: Joi.string().allow('').required(),
  education: Joi.string().allow('').required(),
  skills: Joi.string().allow('').required(),
  experience: Joi.string().allow('').required(),
});

// Up to 20 practice questions per call (one results screen); the AI service
// enforces the same ceiling.
const explainQuestions = Joi.object({
  questions: Joi.array()
    .items(
      Joi.object({
        question: Joi.string().trim().min(1).max(1500).required(),
        options: Joi.array().items(Joi.string().trim().min(1).max(500)).min(2).max(6).required(),
        correct_answer: Joi.string().trim().min(1).max(500).required(),
        data_presentation: Joi.string().trim().max(1000).allow('', null),
      })
    )
    .min(1)
    .max(20)
    .required(),
});

module.exports = { improveResume, explainQuestions };
