const resultService = require('../services/result.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await resultService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const getById = asyncHandler(async (req, res) => {
  const result = await resultService.getById(req.params.id);
  ApiResponse.ok(res, result);
});

const create = asyncHandler(async (req, res) => {
  const result = await resultService.create(req.body);
  ApiResponse.created(res, result);
});

module.exports = { list, getById, create };
