const BaseService = require('./BaseService');
const notificationRepository = require('../repositories/notification.repository');
const userRepository = require('../repositories/user.repository');
const { ROLES } = require('../config/constants');
const { assertSameInstitution } = require('../utils/authz');
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

  // Previously a bare insert of whatever user_id was posted — any staff actor
  // could notify a user in a different institution. HR is exempted inline
  // (rather than in the shared assertSameInstitution default) because HR
  // legitimately recruits/notifies across institutions, per the route's own
  // authorize() list already granting HR this permission.
  async create(data, actor) {
    const targetUser = await userRepository.findById(data.user_id);
    if (!targetUser) throw ApiError.badRequest('Target user does not exist');
    if (actor.role !== ROLES.SUPER_ADMIN && actor.role !== ROLES.HR) {
      assertSameInstitution(actor, targetUser);
    }
    return this.repository.create(data);
  }

  async markRead(id, actor) {
    const notification = await this.repository.findById(id);
    if (!notification) throw ApiError.notFound('Notification not found');
    if (notification.user_id !== actor.id) throw ApiError.forbidden('Not your notification');
    return this.repository.updateById(id, { is_read: true });
  }
}

module.exports = new NotificationService();
