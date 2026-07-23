const Joi = require('joi');

const create = Joi.object({
  name: Joi.string().min(2).max(255).required(),
  code: Joi.string().min(2).max(50).required(),
  address: Joi.string().max(1000).allow('', null),
  contact_email: Joi.string().email().allow('', null),
  contact_phone: Joi.string().max(30).allow('', null),
  is_active: Joi.boolean(),
});

const update = create.fork(['name', 'code'], (s) => s.optional());

module.exports = { create, update };
