const Joi = require('joi');

// Shared by every Reports & Compliance endpoint. `year` is the graduating
// year of a batch (students.batch_year) — the UI shows it as an academic
// year, "2025-26" being year 2026. Only a super_admin (no institution of
// their own) has to say which institution to report on.
const filters = Joi.object({
  year: Joi.number().integer().min(2000).max(2100),
  department_id: Joi.string().uuid(),
  institution_id: Joi.string().uuid(),
});

const auditLog = filters.keys({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

module.exports = { filters, auditLog };
