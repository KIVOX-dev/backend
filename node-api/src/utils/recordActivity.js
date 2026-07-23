const activityLogRepository = require('../repositories/activityLog.repository');
const logger = require('./logger');

// Fire-and-forget audit logging — a logging failure must never break the primary request.
async function recordActivity({ userId = null, action, entityType = null, entityId = null, metadata = {}, ipAddress = null }) {
  try {
    await activityLogRepository.create({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
      ip_address: ipAddress,
    });
  } catch (err) {
    logger.error('Failed to record activity log', { error: err.message, action });
  }
}

module.exports = recordActivity;
