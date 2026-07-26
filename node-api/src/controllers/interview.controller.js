const interviewService = require('../services/interview.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const generate = asyncHandler(async (req, res) => {
  const questions = await interviewService.generateQuestions(req.query.role, req.query.company);
  ApiResponse.ok(res, questions);
});

module.exports = { generate };
