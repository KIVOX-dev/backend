const testAssignmentService = require('../services/testAssignment.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await testAssignmentService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const getById = asyncHandler(async (req, res) => {
  const assignment = await testAssignmentService.getById(req.params.id, req.user);
  ApiResponse.ok(res, assignment);
});

const create = asyncHandler(async (req, res) => {
  const assignment = await testAssignmentService.create(req.body, req.user);
  ApiResponse.created(res, assignment);
});

const update = asyncHandler(async (req, res) => {
  const assignment = await testAssignmentService.update(req.params.id, req.body, req.user);
  ApiResponse.ok(res, assignment, 'Updated');
});

const getQuestions = asyncHandler(async (req, res) => {
  const questions = await testAssignmentService.getQuestions(req.params.id, req.user);
  ApiResponse.ok(res, questions);
});

const submit = asyncHandler(async (req, res) => {
  const attempt = await testAssignmentService.submitForAssignment(req.params.id, req.body, req.user);
  ApiResponse.created(res, attempt);
});

module.exports = { list, getById, create, update, getQuestions, submit };
