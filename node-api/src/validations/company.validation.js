const Joi = require('joi');

const create = Joi.object({
  name: Joi.string().min(2).max(255).required(),
  website: Joi.string().uri().max(255).allow('', null),
  industry: Joi.string().max(120).allow('', null),
  contact_email: Joi.string().email().allow('', null),
  contact_phone: Joi.string().max(30).allow('', null),
  is_active: Joi.boolean(),
});

const update = create.fork(['name'], (s) => s.optional());

module.exports = { create, update };
