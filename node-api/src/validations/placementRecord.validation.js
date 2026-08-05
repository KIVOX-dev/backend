const Joi = require('joi');

const create = Joi.object({
  // Only used when a staff member reports on behalf of a student — ignored/
  // derived from the caller's own profile when a student self-reports. See
  // placementRecord.service.js#create.
  student_id: Joi.string().uuid(),
  company_name: Joi.string().min(1).max(255).required(),
  role: Joi.string().min(1).max(255).required(),
  salary_lpa: Joi.number().min(0).allow(null),
  work_type: Joi.string().max(50).allow('', null),
  mode: Joi.string().max(50).allow('', null),
  location: Joi.string().max(255).allow('', null),
  // No longer client-supplied: derived from the uploaded proof_file, if any
  // (see upload.js's documentUpload / placementRecord.service.js#create).
});

const verify = Joi.object({
  verification_status: Joi.string().valid('pending', 'verified', 'rejected').required(),
});

module.exports = { create, verify };
