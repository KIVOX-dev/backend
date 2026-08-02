const Joi = require('joi');

const create = Joi.object({
  institution_id: Joi.string().uuid().required(),
  name: Joi.string().min(2).max(255).required(),
  code: Joi.string().min(1).max(50).required(),
  // Used to compute students' graduation year (see utils/graduationYear.js)
  // — defaults to 3 (most programs here) when a department doesn't set it.
  duration_years: Joi.number().integer().min(1).max(10).default(3),
});

const update = create.fork(['institution_id', 'name', 'code'], (s) => s.optional());

module.exports = { create, update };
