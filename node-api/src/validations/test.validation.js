const Joi = require('joi');

const create = Joi.object({
  institution_id: Joi.string().uuid().required(),
  title: Joi.string().min(2).max(255).required(),
  description: Joi.string().max(5000).allow('', null),
  test_type: Joi.string().valid('mcq', 'coding', 'mixed'),
  duration_minutes: Joi.number().integer().min(1).required(),
  total_marks: Joi.number().integer().min(1).required(),
  difficulty: Joi.string().valid('easy', 'medium', 'hard'),
  pass_percentage: Joi.number().min(0).max(100),
  negative_marking: Joi.boolean(),
  status: Joi.string().valid('draft', 'active', 'closed'),
});

const update = create.fork(['institution_id', 'title', 'duration_minutes', 'total_marks'], (s) => s.optional());

const generateQuestions = Joi.object({
  title: Joi.string().max(255),
  type: Joi.string().max(50),
  difficulty: Joi.string().max(50),
});

const submit = Joi.object({
  test_id: Joi.string().uuid().allow(null),
  score: Joi.number().min(0).required(),
  max_score: Joi.number().greater(0).required(),
  percentage: Joi.number().min(0).max(100).allow(null),
  time_taken_seconds: Joi.number().integer().min(0).allow(null),
  section_scores: Joi.object().unknown(true).allow(null),
  weak_areas: Joi.array().items(Joi.string()).allow(null),
});

module.exports = { create, update, generateQuestions, submit };
