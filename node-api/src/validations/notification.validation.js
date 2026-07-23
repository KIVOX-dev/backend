const Joi = require('joi');

const create = Joi.object({
  user_id: Joi.string().uuid().required(),
  title: Joi.string().min(1).max(255).required(),
  message: Joi.string().min(1).max(2000).required(),
  type: Joi.string().valid('info', 'success', 'warning', 'error'),
});

module.exports = { create };
