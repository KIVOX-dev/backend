const Joi = require('joi');

const register = Joi.object({
  email: Joi.string().email().max(255).required(),
  password: Joi.string().min(8).max(128).required(),
  // The live frontend sends `name`, not `fullName` — both accepted; see
  // authService.js#register for how they're reconciled. Same for
  // company_name/companyName (only sent by the HR signup flow).
  name: Joi.string().min(2).max(255),
  fullName: Joi.string().min(2).max(255),
  phone: Joi.string().max(30).allow('', null),
  institutionId: Joi.string().uuid().allow(null),
  // Accepts either node-api's own role names or python-service's original
  // ones (college_admin, recruiter) — see roleMapping.js#mapPythonRole,
  // reused here. Anything not in the self-registerable allow-list falls
  // back to student — see authService.js#register.
  role: Joi.string().max(50),
  company_name: Joi.string().max(255).allow('', null),
  companyName: Joi.string().max(255).allow('', null),
}).or('name', 'fullName');

const login = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const googleLogin = Joi.object({
  idToken: Joi.string().required(),
});

const refresh = Joi.object({
  refreshToken: Joi.string().required(),
});

const forgotPassword = Joi.object({
  email: Joi.string().email().required(),
});

const resetPassword = Joi.object({
  token: Joi.string().required(),
  newPassword: Joi.string().min(8).max(128).required(),
});

const verifyEmail = Joi.object({
  token: Joi.string().required(),
});

module.exports = { register, login, googleLogin, refresh, forgotPassword, resetPassword, verifyEmail };
