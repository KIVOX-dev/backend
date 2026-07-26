const Joi = require('joi');

const create = Joi.object({
  collegeId: Joi.string().uuid().required(),
  departmentId: Joi.string().uuid().required(),
  rollNumber: Joi.string().min(1).max(50).required(),
  year: Joi.number().integer().min(1).max(6).required(),
  semester: Joi.number().integer().min(1).max(12).required(),
  section: Joi.string().min(1).max(10).required(),
  phone: Joi.string().max(30).allow('', null),
  dateOfBirth: Joi.date().iso().allow(null),
  gender: Joi.string().max(30).allow('', null),
  address: Joi.string().max(1000).allow('', null),
});

// Same fields, all optional — a student may update just one field at a time.
const update = Joi.object({
  collegeId: Joi.string().uuid(),
  departmentId: Joi.string().uuid(),
  rollNumber: Joi.string().min(1).max(50),
  year: Joi.number().integer().min(1).max(6),
  semester: Joi.number().integer().min(1).max(12),
  section: Joi.string().min(1).max(10),
  phone: Joi.string().max(30).allow('', null),
  dateOfBirth: Joi.date().iso().allow(null),
  gender: Joi.string().max(30).allow('', null),
  address: Joi.string().max(1000).allow('', null),
});

module.exports = { create, update };
