const Joi = require('joi');

const create = Joi.object({
  company_id: Joi.string().uuid().required(),
  institution_id: Joi.string().uuid().required(),
  title: Joi.string().min(2).max(255).required(),
  description: Joi.string().max(5000).allow('', null),
  job_type: Joi.string().max(50),
  package_lpa: Joi.number().min(0).allow(null),
  eligibility_criteria: Joi.object().unknown(true),
  application_deadline: Joi.date().iso().allow(null),
  drive_date: Joi.date().iso().allow(null),
  status: Joi.string().valid('draft', 'open', 'closed', 'cancelled'),
});

const update = create.fork(['company_id', 'institution_id', 'title'], (s) => s.optional());

module.exports = { create, update };
