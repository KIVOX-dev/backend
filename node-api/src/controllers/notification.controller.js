const notificationService = require('../services/notification.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await notificationService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const create = asyncHandler(async (req, res) => {
  const notification = await notificationService.create(req.body, req.user);
  ApiResponse.created(res, notification);
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markRead(req.params.id, req.user);
  ApiResponse.ok(res, notification, 'Marked as read');
});

module.exports = { list, create, markRead };
