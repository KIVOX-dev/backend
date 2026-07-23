const Joi = require('joi');

const create = Joi.object({
  institution_id: Joi.string().uuid().required(),
  title: Joi.string().min(2).max(255).required(),
  description: Joi.string().max(5000).allow('', null),
  test_type: Joi.string().valid('mcq', 'coding', 'mixed'),
  duration_minutes: Joi.number().integer().min(1).required(),
  total_marks: Joi.number().integer().min(1).required(),
});

const update = create.fork(['institution_id', 'title', 'duration_minutes', 'total_marks'], (s) => s.optional());

module.exports = { create, update };
