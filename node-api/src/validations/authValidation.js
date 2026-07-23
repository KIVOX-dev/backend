const Joi = require('joi');

const register = Joi.object({
  email: Joi.string().email().max(255).required(),
  password: Joi.string().min(8).max(128).required(),
  fullName: Joi.string().min(2).max(255).required(),
  phone: Joi.string().max(30).allow('', null),
  institutionId: Joi.string().uuid().allow(null),
});

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

module.exports = { register, login, googleLogin, refresh };
