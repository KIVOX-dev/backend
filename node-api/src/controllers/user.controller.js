const userService = require('../services/user.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await userService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const listPending = asyncHandler(async (req, res) => {
  const { rows, meta } = await userService.listPending(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const getById = asyncHandler(async (req, res) => {
  const user = await userService.getById(req.params.id, req.user);
  ApiResponse.ok(res, user);
});

const create = asyncHandler(async (req, res) => {
  const user = await userService.create(req.body, req.user);
  ApiResponse.created(res, user);
});

const uploadMyAvatar = asyncHandler(async (req, res) => {
  const file = (req.files || [])[0];
  if (!file) throw ApiError.badRequest('No image uploaded');
  const user = await userService.setOwnMedia(req.user, 'avatar_url', file.storageRef);
  ApiResponse.ok(res, user, 'Profile photo updated');
});

const uploadMyCover = asyncHandler(async (req, res) => {
  const file = (req.files || [])[0];
  if (!file) throw ApiError.badRequest('No image uploaded');
  const user = await userService.setOwnMedia(req.user, 'cover_image_url', file.storageRef);
  ApiResponse.ok(res, user, 'Cover image updated');
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
  const user = await userService.approve(req.params.id, req.user);
  ApiResponse.ok(res, user, 'Approved');
});

const reject = asyncHandler(async (req, res) => {
  const user = await userService.reject(req.params.id, req.user);
  ApiResponse.ok(res, user, 'Rejected');
});

module.exports = { list, listPending, getById, create, update, remove, approve, reject, uploadMyAvatar, uploadMyCover };
