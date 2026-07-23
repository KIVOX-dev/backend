const Joi = require('joi');

const create = Joi.object({
  placement_id: Joi.string().uuid().required(),
});

const updateStatus = Joi.object({
  status: Joi.string()
    .valid('applied', 'shortlisted', 'interview', 'selected', 'rejected', 'withdrawn')
    .required(),
});

module.exports = { create, updateStatus };
