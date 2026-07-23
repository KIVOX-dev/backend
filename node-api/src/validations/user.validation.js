const Joi = require('joi');
const { ALL_ROLES } = require('../config/constants');

const create = Joi.object({
  email: Joi.string().email().max(255).required(),
  password: Joi.string().min(8).max(128).required(),
  full_name: Joi.string().min(2).max(255).required(),
  phone: Joi.string().max(30).allow('', null),
  role: Joi.string().valid(...ALL_ROLES).required(),
  institution_id: Joi.string().uuid().allow(null),
  is_active: Joi.boolean(),
});

const update = Joi.object({
  email: Joi.string().email().max(255),
  password: Joi.string().min(8).max(128),
  full_name: Joi.string().min(2).max(255),
  phone: Joi.string().max(30).allow('', null),
  role: Joi.string().valid(...ALL_ROLES),
  institution_id: Joi.string().uuid().allow(null),
  is_active: Joi.boolean(),
});

module.exports = { create, update };
