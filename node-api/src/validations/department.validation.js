const Joi = require('joi');

const create = Joi.object({
  institution_id: Joi.string().uuid().required(),
  name: Joi.string().min(2).max(255).required(),
  code: Joi.string().min(1).max(50).required(),
});

const update = create.fork(['institution_id', 'name', 'code'], (s) => s.optional());

module.exports = { create, update };
