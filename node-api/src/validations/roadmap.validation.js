const Joi = require('joi');
const { ROLES } = require('../config/jobRoleCatalog');

const roleIds = ROLES.map((role) => role.id);

const targetRole = Joi.object({
  roleId: Joi.string().valid(...roleIds).required(),
});

module.exports = { targetRole };
