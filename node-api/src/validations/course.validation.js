const Joi = require('joi');

const importCourse = Joi.object({
  url: Joi.string().max(2048).required(),
});

const updateProgress = Joi.object({
  status: Joi.string().valid('not_started', 'in_progress', 'completed'),
  watchedSeconds: Joi.number().min(0),
}).or('status', 'watchedSeconds');

const createNote = Joi.object({
  timestampSeconds: Joi.number().min(0).required(),
  text: Joi.string().trim().min(1).max(2000).required(),
});

const submitAssessment = Joi.object({
  // One selected option string (or null for "left blank") per question, in
  // question order — course.service.js#submitLessonAssessment grades
  // positionally against the lesson's stored question order.
  answers: Joi.array().items(Joi.string().allow(null)).min(1).required(),
  // Self-reported by AssessmentWindow.tsx's proctoring gate — see
  // lessonAssessmentAttempt.model.js's comment on why this is a soft signal,
  // not a verified one. Optional: a plain quiz submit (no gate) omits it.
  violations: Joi.object({
    tab_switches: Joi.number().integer().min(0),
    copy_paste: Joi.number().integer().min(0),
    screen_share_stopped: Joi.number().integer().min(0),
  }),
});

module.exports = {
  importCourse,
  updateProgress,
  createNote,
  submitAssessment,
};
