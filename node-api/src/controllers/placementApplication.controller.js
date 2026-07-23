const placementApplicationService = require('../services/placementApplication.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await placementApplicationService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const getById = asyncHandler(async (req, res) => {
  const application = await placementApplicationService.getById(req.params.id);
  ApiResponse.ok(res, application);
});

const create = asyncHandler(async (req, res) => {
  const application = await placementApplicationService.create(req.body, req.user);
  ApiResponse.created(res, application);
});

const updateStatus = asyncHandler(async (req, res) => {
  const application = await placementApplicationService.updateStatus(req.params.id, req.body.status, req.user);
  ApiResponse.ok(res, application, 'Status updated');
});

module.exports = { list, getById, create, updateStatus };
