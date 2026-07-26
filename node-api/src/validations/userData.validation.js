const Joi = require('joi');

const save = Joi.object({
  data: Joi.object().unknown(true).required(),
});

module.exports = { save };
