const Joi = require('joi');

const generate = Joi.object({
  role: Joi.string().min(1).max(255).required(),
  company: Joi.string().max(255),
});

module.exports = { generate };
