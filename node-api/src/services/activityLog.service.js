const BaseService = require('./BaseService');
const activityLogRepository = require('../repositories/activityLog.repository');

module.exports = new BaseService(activityLogRepository, { entityName: 'Activity log' });
