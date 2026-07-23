const createCrudController = require('./crudControllerFactory');
const placementService = require('../services/placement.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(placementService);

const create = asyncHandler(async (req, res) => {
  const placement = await placementService.create(req.body, req.user);
  ApiResponse.created(res, placement);
});

module.exports = { ...base, create };
