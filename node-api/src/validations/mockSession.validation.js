const Joi = require('joi');

const createSession = Joi.object({
  role: Joi.string().min(1).max(255).required(),
  company: Joi.string().max(255).allow('').default(''),
});

const mcqItem = Joi.object({
  question: Joi.string().max(2000).required(),
  section: Joi.string().max(100).allow('').default('General'),
  options: Joi.array().items(Joi.string().max(500)).max(6).default([]),
  selected: Joi.string().max(500).allow(null, '').default(null),
  correct_answer: Joi.string().max(500).required(),
  explanation: Joi.string().max(600).allow('').default(''),
});

const gdTurn = Joi.object({
  speaker: Joi.string().max(60).required(),
  is_student: Joi.boolean().default(false),
  text: Joi.string().max(2000).allow('').default(''),
  phase: Joi.string().valid('prep', 'discussion', 'closing').default('discussion'),
  at_ms: Joi.number().min(0).default(0),
  duration_ms: Joi.number().min(0).max(600000).default(0),
  interrupts: Joi.boolean().default(false),
  interrupted_student: Joi.boolean().default(false),
  references_other: Joi.boolean().default(false),
});

const hrPair = Joi.object({
  question: Joi.string().max(1000).required(),
  answer: Joi.string().max(8000).allow('').default(''),
});

// Keyed by round number (1 MCQ, 2 Group Discussion, 3 HR).
const submitRound = {
  1: Joi.object({ items: Joi.array().items(mcqItem).min(1).max(60).required() }),
  2: Joi.object({
    topic: Joi.string().max(300).required(),
    category: Joi.string().max(60).allow('').default(''),
    difficulty: Joi.string().valid('easy', 'medium', 'hard').default('medium'),
    turns: Joi.array().items(gdTurn).max(400).required(),
    duration_seconds: Joi.number().min(0).max(7200).default(0),
  }),
  3: Joi.object({
    pairs: Joi.array().items(hrPair).min(1).max(40).required(),
    duration_seconds: Joi.number().min(0).max(7200).default(0),
  }),
};

module.exports = { createSession, submitRound };
