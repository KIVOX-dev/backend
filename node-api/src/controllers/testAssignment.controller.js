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

const getSession = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await testAssignmentService.getSession(req.params.id, req.user));
});

const autosave = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await testAssignmentService.autosave(req.params.id, req.body, req.user), 'Saved');
});

const resume = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await testAssignmentService.resume(req.params.id, req.body, req.user));
});

module.exports = { list, getById, create, update, getQuestions, submit, getSession, autosave, resume };
