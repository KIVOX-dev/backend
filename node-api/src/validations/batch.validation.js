const Joi = require('joi');

const batchStudent = Joi.object({
  email: Joi.string().email(),
  roll: Joi.string().max(50),
  studentId: Joi.string().max(50),
  name: Joi.string().max(255).required(),
  password: Joi.string().min(8).max(128),
  department: Joi.string().max(255),
  year: Joi.number().integer(),
}).or('roll', 'studentId');

const create = Joi.object({
  name: Joi.string().min(1).max(255).required(),
  batchCode: Joi.string().max(50),
  department: Joi.string().max(255),
  year: Joi.number().integer(),
  students: Joi.array().items(batchStudent).default([]),
});

const updateStatus = Joi.object({
  status: Joi.string().valid('active', 'archived', 'completed').required(),
});

module.exports = { create, updateStatus };
