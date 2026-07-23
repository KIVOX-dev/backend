const Joi = require('joi');

const save = Joi.object({
  template: Joi.string().max(50),
  data: Joi.object().unknown(true).required(),
});

module.exports = { save };
