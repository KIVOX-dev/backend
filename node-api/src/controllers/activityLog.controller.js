const createCrudController = require('./crudControllerFactory');
const activityLogService = require('../services/activityLog.service');

// Read-only: activity logs are written internally via utils/recordActivity, never through the API.
const { list, getById } = createCrudController(activityLogService);

module.exports = { list, getById };
