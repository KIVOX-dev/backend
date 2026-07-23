const Joi = require('joi');

const create = Joi.object({
  test_id: Joi.string().uuid().required(),
  student_id: Joi.string().uuid().required(),
  scheduled_at: Joi.date().iso().allow(null),
});

const update = Joi.object({
  scheduled_at: Joi.date().iso().allow(null),
  status: Joi.string().valid('assigned', 'in_progress', 'completed', 'expired'),
});

module.exports = { create, update };
