const Joi = require('joi');

const departmentSeed = Joi.object({
  name: Joi.string().min(1).max(255).required(),
  code: Joi.string().min(1).max(50).required(),
});

const create = Joi.object({
  name: Joi.string().min(2).max(255).required(),
  code: Joi.string().min(2).max(50).required(),
  address: Joi.string().max(1000).allow('', null),
  location: Joi.string().max(255).allow('', null),
  website: Joi.string().uri().allow('', null),
  contact_email: Joi.string().email().allow('', null),
  contact_phone: Joi.string().max(30).allow('', null),
  is_active: Joi.boolean(),
  // Ported from python-service's colleges.py: optional initial department
  // roster, cascade-created alongside the institution (create-only, not
  // accepted on update).
  departments: Joi.array().items(departmentSeed),
});

const update = Joi.object({
  name: Joi.string().min(2).max(255),
  code: Joi.string().min(2).max(50),
  address: Joi.string().max(1000).allow('', null),
  location: Joi.string().max(255).allow('', null),
  website: Joi.string().uri().allow('', null),
  contact_email: Joi.string().email().allow('', null),
  contact_phone: Joi.string().max(30).allow('', null),
  is_active: Joi.boolean(),
});

module.exports = { create, update };
