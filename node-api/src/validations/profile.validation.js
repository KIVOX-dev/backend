const Joi = require('joi');
const { SCHEMAS, portalForRole } = require('../config/onboardingSchemas');
const ApiError = require('../utils/ApiError');

// Derives a Joi whitelist schema per onboarding portal straight from
// onboardingSchemas.js's field definitions, so the form the frontend renders
// and what the server accepts can't drift into two separate lists. Closes
// PROJECT_AUDIT_REPORT.md P1-4: POST/PUT /profile used to accept an
// arbitrary `values` object with no server-side check at all.
//
// File-type fields (profilePhoto/signature) are deliberately excluded here —
// multer pulls those out of the multipart request into req.files before this
// runs; they never arrive as plain body values (see
// profile.controller.js#saveOwn, which folds the uploaded path in afterward).
//
// `required` is intentionally not enforced server-side, matching the
// existing, documented "schema is a client-rendering contract" design and
// preserving the same full-overwrite/partial-save behavior saveOwn already
// has — this only closes the mass-assignment gap (unknown/extra fields),
// not add a new completeness requirement nothing currently exercises.
function fieldJoiType(field) {
  switch (field.type) {
    case 'number': {
      let schema = Joi.number();
      if (field.validation?.min !== undefined) schema = schema.min(field.validation.min);
      if (field.validation?.max !== undefined) schema = schema.max(field.validation.max);
      return schema;
    }
    case 'select':
      return field.options ? Joi.string().valid(...field.options.map((o) => o.value)) : Joi.string().allow('');
    case 'url':
      return Joi.string().uri().allow('');
    default:
      return Joi.string().allow('');
  }
}

const PORTAL_SCHEMAS = Object.fromEntries(
  Object.entries(SCHEMAS).map(([portal, def]) => {
    const shape = {};
    for (const section of def.sections) {
      for (const field of section.fields) {
        if (field.type === 'file') continue;
        shape[field.name] = fieldJoiType(field).optional();
      }
    }
    return [portal, Joi.object(shape)];
  })
);

// Not built on the generic middlewares/validate.js: which schema applies
// depends on req.user's role (which onboarding portal they belong to), so it
// can't be selected until request time the way a static per-route schema can.
// Same contract otherwise — unknown fields rejected, 400 with per-field
// messages on failure.
function validateProfileValues(req, res, next) {
  const portal = portalForRole(req.user.role);
  const schema = portal && PORTAL_SCHEMAS[portal];
  if (!schema) throw ApiError.badRequest(`No onboarding profile exists for role '${req.user.role}'`);

  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    const details = error.details.map((d) => d.message);
    throw ApiError.badRequest('Validation failed', details, 'VALIDATION_ERROR');
  }
  req.body = value;
  next();
}

module.exports = { validateProfileValues, PORTAL_SCHEMAS };
