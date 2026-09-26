const interviewService = require('../services/interview.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const generate = asyncHandler(async (req, res) => {
  const questions = await interviewService.generateQuestions(req.query.role, req.query.company, req.query.round);
  ApiResponse.ok(res, questions);
});

const generateMcq = asyncHandler(async (req, res) => {
  const result = await interviewService.generateMcq(req.query.role, req.query.company, req.query.count);
  ApiResponse.ok(res, result);
});

module.exports = { generate, generateMcq };
