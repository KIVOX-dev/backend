const Joi = require('joi');

const create = Joi.object({
  test_assignment_id: Joi.string().uuid().required(),
  marks_obtained: Joi.number().min(0).required(),
  total_marks: Joi.number().greater(0).required(),
});

module.exports = { create };
