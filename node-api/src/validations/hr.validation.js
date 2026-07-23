const Joi = require('joi');

const create = Joi.object({
  user_id: Joi.string().uuid().required(),
  company_id: Joi.string().uuid().required(),
  designation: Joi.string().max(255).allow('', null),
});

const update = Joi.object({
  company_id: Joi.string().uuid(),
  designation: Joi.string().max(255).allow('', null),
});

module.exports = { create, update };
