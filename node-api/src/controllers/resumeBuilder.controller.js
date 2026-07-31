const createCrudController = require('./crudControllerFactory');
const resumeBuilderService = require('../services/resumeBuilder.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(resumeBuilderService);

const getOwn = asyncHandler(async (req, res) => {
  const result = await resumeBuilderService.getOwn(req.user);
  ApiResponse.ok(res, result);
});

const saveOwn = asyncHandler(async (req, res) => {
  const result = await resumeBuilderService.upsertOwn(req.user, req.body);
  ApiResponse.ok(res, result, 'Resume saved');
});

const addVersion = asyncHandler(async (req, res) => {
  const result = await resumeBuilderService.addVersion(req.user, req.body.name);
  ApiResponse.ok(res, result, `Version '${req.body.name}' saved successfully`);
});

const restoreVersion = asyncHandler(async (req, res) => {
  const result = await resumeBuilderService.restoreVersion(req.user, req.params.versionId);
  ApiResponse.ok(res, result, 'Resume restored to selected version');
});

const deleteVersion = asyncHandler(async (req, res) => {
  const result = await resumeBuilderService.deleteVersion(req.user, req.params.versionId);
  ApiResponse.ok(res, result, 'Version deleted');
});

const analyze = asyncHandler(async (req, res) => {
  const result = await resumeBuilderService.analyze(req.user);
  ApiResponse.ok(res, result);
});

const matchJobDescription = asyncHandler(async (req, res) => {
  const result = await resumeBuilderService.matchJobDescription(req.user, req.body.jd_text);
  ApiResponse.ok(res, result);
});

const aiSuggest = asyncHandler(async (req, res) => {
  const result = await resumeBuilderService.aiSuggest(req.user, req.body);
  ApiResponse.ok(res, result);
});

const parseResumeText = asyncHandler(async (req, res) => {
  const result = await resumeBuilderService.parseResumeText(req.body.text);
  ApiResponse.ok(res, result);
});

module.exports = {
  ...base,
  getOwn,
  saveOwn,
  addVersion,
  restoreVersion,
  deleteVersion,
  analyze,
  matchJobDescription,
  aiSuggest,
  parseResumeText,
};
