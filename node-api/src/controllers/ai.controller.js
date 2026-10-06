const resumeBuilderService = require('../services/resumeBuilder.service');
const questionExplanationService = require('../services/questionExplanation.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

// Lives in resumeBuilder.service.js alongside resume.py's Groq methods (same
// dependency, same model) — this controller just gives it python-service's
// original separate /ai prefix, since that's the path the frontend calls.
const improveResume = asyncHandler(async (req, res) => {
  const result = await resumeBuilderService.improveResumeText(req.body);
  ApiResponse.ok(res, result);
});

const explainQuestions = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await questionExplanationService.explain(req.body.questions));
});

module.exports = { improveResume, explainQuestions };
