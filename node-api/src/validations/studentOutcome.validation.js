const Joi = require('joi');
const { EXAMS } = require('../models/studentOutcome.model');

const thisYear = new Date().getFullYear();
const year = Joi.number().integer().min(1990).max(thisYear + 1);

// Multipart bodies arrive as strings; Joi's default conversion turns "2026"
// and "true" into the number/boolean the schema asks for.
const create = Joi.object({
  // Only used when staff report on behalf of a student — ignored when a
  // student self-reports (see studentOutcome.service.js#create).
  student_id: Joi.string().uuid(),
  type: Joi.string().valid('higher_study', 'competitive_exam').required(),

  course: Joi.when('type', { is: 'higher_study', then: Joi.string().trim().min(1).max(255).required(), otherwise: Joi.forbidden() }),
  institution_name: Joi.when('type', { is: 'higher_study', then: Joi.string().trim().min(1).max(255).required(), otherwise: Joi.forbidden() }),
  admission_year: Joi.when('type', { is: 'higher_study', then: year.allow('', null), otherwise: Joi.forbidden() }),

  exam: Joi.when('type', { is: 'competitive_exam', then: Joi.string().valid(...EXAMS).required(), otherwise: Joi.forbidden() }),
  exam_year: Joi.when('type', { is: 'competitive_exam', then: year.required(), otherwise: Joi.forbidden() }),
  score: Joi.when('type', { is: 'competitive_exam', then: Joi.string().trim().max(50).allow('', null), otherwise: Joi.forbidden() }),
  rank_or_percentile: Joi.when('type', { is: 'competitive_exam', then: Joi.string().trim().max(50).allow('', null), otherwise: Joi.forbidden() }),
  qualified: Joi.when('type', { is: 'competitive_exam', then: Joi.boolean().default(false), otherwise: Joi.forbidden() }),
});

const verify = Joi.object({
  verification_status: Joi.string().valid('pending', 'verified', 'rejected').required(),
});

module.exports = { create, verify };
