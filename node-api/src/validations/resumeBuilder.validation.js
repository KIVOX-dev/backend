const Joi = require('joi');

// Autosave — every section optional so a partial save (e.g. just one section
// edited client-side) doesn't require resending the whole document. Content
// inside each array/object isn't schema-validated (matches python-service,
// which trusted its own Pydantic list[Dict[str, Any]] — effectively
// unvalidated nested shape too).
const save = Joi.object({
  personal: Joi.object().unknown(true),
  objective: Joi.string().allow(''),
  education: Joi.array().items(Joi.object().unknown(true)),
  experience: Joi.array().items(Joi.object().unknown(true)),
  projects: Joi.array().items(Joi.object().unknown(true)),
  skills: Joi.array().items(Joi.object().unknown(true)),
  certifications: Joi.array().items(Joi.object().unknown(true)),
  internships: Joi.array().items(Joi.object().unknown(true)),
  achievements: Joi.array().items(Joi.object().unknown(true)),
  hackathons: Joi.array().items(Joi.object().unknown(true)),
  publications: Joi.array().items(Joi.object().unknown(true)),
  languages: Joi.array().items(Joi.object().unknown(true)),
  volunteer: Joi.array().items(Joi.object().unknown(true)),
  references: Joi.array().items(Joi.object().unknown(true)),
  customSections: Joi.array().items(Joi.object().unknown(true)),
  sectionOrder: Joi.array().items(Joi.string()),
  template: Joi.string().max(50),
  zoom: Joi.number().min(0.1).max(3),
});

const saveVersion = Joi.object({
  name: Joi.string().min(1).max(255).required(),
});

const matchJd = Joi.object({
  jd_text: Joi.string().min(1).required(),
});

const aiSuggest = Joi.object({
  action: Joi.string().valid('summary', 'rewrite', 'skills', 'grammar', 'cover_letter', 'interview_prep').required(),
  section: Joi.string().max(100).allow('', null),
  content: Joi.string().allow('', null),
  jd_text: Joi.string().allow('', null),
});

const parse = Joi.object({
  text: Joi.string().min(1).required(),
});

module.exports = { save, saveVersion, matchJd, aiSuggest, parse };
