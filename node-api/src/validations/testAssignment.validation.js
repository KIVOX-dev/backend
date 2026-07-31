const Joi = require('joi');

const create = Joi.object({
  test_id: Joi.string().uuid().required(),
  // Exactly one assignment mode: an explicit single student, or a bulk
  // department+batch_year filter (both required together) — see
  // testAssignment.service.js#create for how each is handled.
  student_id: Joi.string().uuid(),
  department_id: Joi.string().uuid(),
  batch_year: Joi.number().integer().min(1990).max(2100),
  scheduled_at: Joi.date().iso().allow(null),
})
  .xor('student_id', 'department_id')
  .and('department_id', 'batch_year');

const update = Joi.object({
  scheduled_at: Joi.date().iso().allow(null),
  status: Joi.string().valid('assigned', 'in_progress', 'completed', 'expired'),
});

const submit = Joi.object({
  answers: Joi.object().pattern(Joi.string().uuid(), Joi.string().max(2000)).required(),
});

module.exports = { create, update, submit };
