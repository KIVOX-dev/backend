const userService = require('../services/user.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await userService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const listPending = asyncHandler(async (req, res) => {
  const { rows, meta } = await userService.listPending(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const getById = asyncHandler(async (req, res) => {
  const user = await userService.getById(req.params.id);
  ApiResponse.ok(res, user);
});

const create = asyncHandler(async (req, res) => {
  const user = await userService.create(req.body, req.user);
  ApiResponse.created(res, user);
});

const update = asyncHandler(async (req, res) => {
  const user = await userService.update(req.params.id, req.body, req.user);
  ApiResponse.ok(res, user, 'Updated');
});

const remove = asyncHandler(async (req, res) => {
  await userService.remove(req.params.id, req.user);
  ApiResponse.ok(res, null, 'Deleted');
});

const approve = asyncHandler(async (req, res) => {
  const user = await userService.approve(req.params.id);
  ApiResponse.ok(res, user, 'Approved');
});

const reject = asyncHandler(async (req, res) => {
  const user = await userService.reject(req.params.id);
  ApiResponse.ok(res, user, 'Rejected');
});

module.exports = { list, listPending, getById, create, update, remove, approve, reject };
