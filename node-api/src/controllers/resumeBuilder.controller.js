const createCrudController = require('./crudControllerFactory');
const resumeBuilderService = require('../services/resumeBuilder.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(resumeBuilderService);

// Overrides the generic base `list` — resumeBuilderService.list() needs
// `actor` for institution scoping (buildInstitutionFilter), which
// crudControllerFactory's generic list handler never passes. Without this,
// GET /resume/all crashed with a TypeError reading actor.institutionId off
// undefined — a pre-existing bug, unrelated to the Express 5 migration,
// caught while auditing every route using the generic factory's list().
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await resumeBuilderService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

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
  list,
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
