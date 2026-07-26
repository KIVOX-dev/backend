const batchService = require('../services/batch.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const create = asyncHandler(async (req, res) => {
  const batch = await batchService.create(req.body, req.user);
  ApiResponse.created(res, batch);
});

const history = asyncHandler(async (req, res) => {
  const rows = await batchService.history(req.user);
  ApiResponse.ok(res, rows);
});

const listStudents = asyncHandler(async (req, res) => {
  const rows = await batchService.listStudents(req.user);
  ApiResponse.ok(res, rows);
});

const pending = asyncHandler(async (req, res) => {
  const rows = await batchService.pending(req.user);
  ApiResponse.ok(res, rows);
});

const updateStatus = asyncHandler(async (req, res) => {
  await batchService.updateStatus(req.params.id, req.body.status, req.user);
  ApiResponse.ok(res, null, 'Batch status updated');
});

module.exports = { create, history, listStudents, pending, updateStatus };
