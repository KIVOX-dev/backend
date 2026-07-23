const BaseService = require('./BaseService');
const notificationRepository = require('../repositories/notification.repository');
const ApiError = require('../utils/ApiError');

class NotificationService extends BaseService {
  constructor() {
    super(notificationRepository, { entityName: 'Notification' });
  }

  // Notifications are a personal inbox: every list is forced to the caller's own user_id,
  // regardless of role, so nobody can page through another user's notifications.
  async list(queryParams, actor) {
    return super.list(queryParams, { user_id: actor.id });
  }

  async markRead(id, actor) {
    const notification = await this.repository.findById(id);
    if (!notification) throw ApiError.notFound('Notification not found');
    if (notification.user_id !== actor.id) throw ApiError.forbidden('Not your notification');
    return this.repository.updateById(id, { is_read: true });
  }
}

module.exports = new NotificationService();
