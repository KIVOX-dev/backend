const testAssignmentService = require('../services/testAssignment.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await testAssignmentService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const getById = asyncHandler(async (req, res) => {
  const assignment = await testAssignmentService.getById(req.params.id);
  ApiResponse.ok(res, assignment);
});

const create = asyncHandler(async (req, res) => {
  const assignment = await testAssignmentService.create(req.body, req.user);
  ApiResponse.created(res, assignment);
});

const update = asyncHandler(async (req, res) => {
  const assignment = await testAssignmentService.update(req.params.id, req.body);
  ApiResponse.ok(res, assignment, 'Updated');
});

module.exports = { list, getById, create, update };
