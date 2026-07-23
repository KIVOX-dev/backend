const Joi = require('joi');

const create = Joi.object({
  user_id: Joi.string().uuid().required(),
  institution_id: Joi.string().uuid().required(),
  designation: Joi.string().max(255).allow('', null),
});

const update = Joi.object({
  designation: Joi.string().max(255).allow('', null),
});

module.exports = { create, update };
