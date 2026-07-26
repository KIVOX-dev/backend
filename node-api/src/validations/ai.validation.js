const Joi = require('joi');

const improveResume = Joi.object({
  objective: Joi.string().allow('').required(),
  education: Joi.string().allow('').required(),
  skills: Joi.string().allow('').required(),
  experience: Joi.string().allow('').required(),
});

module.exports = { improveResume };
