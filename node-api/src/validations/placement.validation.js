const Joi = require('joi');

const create = Joi.object({
  // Either/both may be set: company_id links to an existing companies record;
  // company_name is free text for a posting whose company isn't in that
  // collection yet (ported from python-service's jobs.py, which never
  // required a company to be pre-registered).
  company_id: Joi.string().uuid().allow(null),
  company_name: Joi.string().max(255).allow('', null),
  // Optional — a recruiter's general opening isn't always tied to one
  // institution's drive (institution_admin-created postings still get their
  // own institution_id forced server-side regardless of what's sent here).
  institution_id: Joi.string().uuid().allow(null),
  title: Joi.string().min(2).max(255).required(),
  description: Joi.string().max(5000).allow('', null),
  job_type: Joi.string().max(50),
  location: Joi.string().max(255).allow('', null),
  package_lpa: Joi.number().min(0).allow(null),
  salary_min_lpa: Joi.number().min(0).allow(null),
  salary_max_lpa: Joi.number().min(0).allow(null),
  required_skills: Joi.array().items(Joi.string().max(100)),
  eligible_departments: Joi.array().items(Joi.string().max(100)),
  eligible_years: Joi.array().items(Joi.number().integer()),
  min_cgpa: Joi.number().min(0).max(10).allow(null),
  eligibility_criteria: Joi.object().unknown(true),
  application_deadline: Joi.date().iso().allow(null),
  drive_date: Joi.date().iso().allow(null),
  status: Joi.string().valid('draft', 'open', 'closed', 'cancelled', 'active'),
  is_active: Joi.boolean(),
});

const update = create.fork(['title'], (s) => s.optional());

module.exports = { create, update };
