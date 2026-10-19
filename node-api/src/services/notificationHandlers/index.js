// One handler per email event. Adding an event — e.g. a future `not_selected`
// for students who don't progress past a round — means adding a handler here
// (what to load, what params to send) plus a template id in
// config/env.js's brevo.templates, and calling emailNotification.service's
// queueRecipients() from wherever the event happens. Nothing else changes.
const handlers = [
  require('./testAssigned'),
  require('./driveAssigned'),
  require('./roundShortlisted'),
  require('./accountCreated'),
];

const byEventType = new Map(handlers.map((h) => [h.eventType, h]));

module.exports = { getHandler: (eventType) => byEventType.get(eventType) || null };
