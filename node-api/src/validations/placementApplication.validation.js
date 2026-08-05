const Joi = require('joi');

const create = Joi.object({
  placement_id: Joi.string().uuid().required(),
  // Only honored for staff (institution_admin/faculty/super_admin) — see
  // placementApplication.service.js#create. Ignored for a student's own
  // self-apply, whose student_id is always derived server-side.
  student_id: Joi.string().uuid(),
  round: Joi.number().integer().min(1).max(20),
});

const updateStatus = Joi.object({
  status: Joi.string()
    .valid('applied', 'shortlisted', 'interview', 'selected', 'rejected', 'withdrawn')
    .required(),
});

// Bulk twin of create's staff-shortlist path — student_ids already resolved
// client-side (see CollegeAdminDashboard.tsx's Excel upload, which matches
// roll numbers against students already loaded in the browser) since this
// API has no reason to parse spreadsheets itself.
const bulkShortlist = Joi.object({
  placement_id: Joi.string().uuid().required(),
  round: Joi.number().integer().min(1).max(20),
  student_ids: Joi.array().items(Joi.string().uuid()).min(1).required(),
});

module.exports = { create, updateStatus, bulkShortlist };
