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
  department: Joi.string().max(255).allow('', null),
  // Cascade-only fields (not stored on the user itself) — see
  // user.service.js#create for how these seed the linked students/faculty/hr
  // row. student_id/year are python-service's original names, accepted as
  // aliases for node-api's roll_number/batch_year.
  student_id: Joi.string().max(50),
  year: Joi.number().integer().min(1990).max(2100),
  roll_number: Joi.string().max(50),
  batch_year: Joi.number().integer().min(1990).max(2100),
  department_id: Joi.string().uuid(),
  company_id: Joi.string().uuid(),
  designation: Joi.string().max(255),
});

const update = Joi.object({
  email: Joi.string().email().max(255),
  password: Joi.string().min(8).max(128),
  full_name: Joi.string().min(2).max(255),
  phone: Joi.string().max(30).allow('', null),
  role: Joi.string().valid(...ALL_ROLES),
  institution_id: Joi.string().uuid().allow(null),
  is_active: Joi.boolean(),
  status: Joi.string().valid('pending', 'approved', 'rejected'),
  is_email_verified: Joi.boolean(),
  avatar_url: Joi.string().uri().allow('', null),
  preferences: Joi.object().unknown(true),
  department: Joi.string().max(255).allow('', null),
});

module.exports = { create, update };
