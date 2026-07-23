const Joi = require('joi');

const create = Joi.object({
  user_id: Joi.string().uuid().required(),
  institution_id: Joi.string().uuid().required(),
  department_id: Joi.string().uuid().allow(null),
  roll_number: Joi.string().max(50).required(),
  batch_year: Joi.number().integer().min(1990).max(2100).required(),
  cgpa: Joi.number().min(0).max(10).allow(null),
  resume_url: Joi.string().uri().allow('', null),
});

const update = Joi.object({
  department_id: Joi.string().uuid().allow(null),
  roll_number: Joi.string().max(50),
  batch_year: Joi.number().integer().min(1990).max(2100),
  cgpa: Joi.number().min(0).max(10).allow(null),
  resume_url: Joi.string().uri().allow('', null),
});

module.exports = { create, update };
