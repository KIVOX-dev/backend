const createCrudController = require('./crudControllerFactory');
const resumeBuilderService = require('../services/resumeBuilder.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(resumeBuilderService);

const getOwn = asyncHandler(async (req, res) => {
  const resume = await resumeBuilderService.getOwn(req.user);
  ApiResponse.ok(res, resume);
});

const saveOwn = asyncHandler(async (req, res) => {
  const resume = await resumeBuilderService.upsertOwn(req.user, req.body);
  ApiResponse.ok(res, resume, 'Resume saved');
});

module.exports = { ...base, getOwn, saveOwn };
