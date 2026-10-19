const Joi = require('joi');

const EVENT_TYPES = ['drive_assigned', 'round_shortlisted'];

// PUT /placements/:id/rounds/:roundNumber — what that round is. Every field is
// optional; omitted ones are left as they were.
const round = Joi.object({
  name: Joi.string().max(100).allow('', null),
  scheduled_at: Joi.date().iso().allow(null),
  venue_or_link: Joi.string().max(500).allow('', null),
  instructions: Joi.string().max(5000).allow('', null),
});

const roundNumber = Joi.number().integer().min(1).max(20);

// GET /drives/:id/notifications?event_type=&round_number=
const notificationsQuery = Joi.object({
  event_type: Joi.string().valid(...EVENT_TYPES),
  round_number: roundNumber,
});

// POST /drives/:id/notifications/resend-failed — optionally scoped.
const resendFailed = Joi.object({
  event_type: Joi.string().valid(...EVENT_TYPES),
  round_number: roundNumber,
});

module.exports = { round, roundNumber, notificationsQuery, resendFailed };
