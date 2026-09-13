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
  // Cloudflare Turnstile token from the widget rendered with data-action="register"
  // — verified server-side in middlewares/verifyTurnstile.js before this schema's
  // result ever reaches the controller.
  turnstileToken: Joi.string().max(2048).required(),
}).or('name', 'fullName');

const login = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
  // Not .required() here (unlike register/forgotPassword) — /auth/login is
  // shared by all 6 role login forms and a huge existing test surface calls
  // it without this field. Enforcement still happens for real: a missing
  // token reaches middlewares/verifyTurnstile.js, which calls the real
  // Cloudflare check and 403s regardless of what Joi allowed through. Making
  // it Joi-required would only change a missing-field response from 403 to
  // 400 — not worth breaking ~20 test files across the suite for that.
  turnstileToken: Joi.string().max(2048),
});

const googleLogin = Joi.object({
  idToken: Joi.string().required(),
});

// Accepts both casings: node-api's own camelCase, and the snake_case body the
// live frontend actually sends from its bare (non-interceptor) refresh call
// in api.ts — stripUnknown otherwise dropped `refresh_token` before it ever
// reached the controller, failing validation on every refresh attempt.
const refresh = Joi.object({
  refreshToken: Joi.string(),
  refresh_token: Joi.string(),
}).or('refreshToken', 'refresh_token');

const forgotPassword = Joi.object({
  email: Joi.string().email().required(),
  // Cloudflare Turnstile token, widget rendered with data-action="forgot_password".
  turnstileToken: Joi.string().max(2048).required(),
});

const resetPassword = Joi.object({
  token: Joi.string().required(),
  newPassword: Joi.string().min(8).max(128).required(),
});

const changeInitialPassword = Joi.object({
  email: Joi.string().email().required(),
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).max(128).required(),
});

const verifyEmail = Joi.object({
  token: Joi.string().required(),
});

// Live frontend sends snake_case (current_password/new_password) from both
// call sites (SettingsPanel, FacultyDashboard) — see auth.controller.js.
const newPasswordRule = Joi.string()
  .min(8)
  .max(128)
  .pattern(/[A-Za-z]/, 'letter')
  .pattern(/\d/, 'number')
  .messages({
    'string.pattern.name': 'Password must contain at least one letter and one number',
  });

const changePassword = Joi.object({
  currentPassword: Joi.string(),
  current_password: Joi.string(),
  newPassword: newPasswordRule,
  new_password: newPasswordRule,
})
  .or('currentPassword', 'current_password')
  .or('newPassword', 'new_password');

module.exports = {
  register,
  login,
  googleLogin,
  refresh,
  forgotPassword,
  resetPassword,
  changeInitialPassword,
  changePassword,
  verifyEmail,
};
