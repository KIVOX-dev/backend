const Joi = require('joi');

const create = Joi.object({
  user_id: Joi.string().uuid().required(),
  institution_id: Joi.string().uuid().required(),
  department_id: Joi.string().uuid().allow(null),
  designation: Joi.string().max(255).allow('', null),
});

const update = Joi.object({
  department_id: Joi.string().uuid().allow(null),
  designation: Joi.string().max(255).allow('', null),
});

module.exports = { create, update };
