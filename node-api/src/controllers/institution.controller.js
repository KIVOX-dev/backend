const createCrudController = require('./crudControllerFactory');
const institutionService = require('../services/institution.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(institutionService);

const publicList = asyncHandler(async (req, res) => {
  const institutions = await institutionService.listPublic();
  ApiResponse.ok(res, institutions);
});

const getOwn = asyncHandler(async (req, res) => {
  const institution = await institutionService.getOwn(req.user);
  ApiResponse.ok(res, institution);
});

module.exports = { ...base, publicList, getOwn };
