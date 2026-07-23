const createCrudController = require('./crudControllerFactory');
const testService = require('../services/test.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(testService);

const create = asyncHandler(async (req, res) => {
  const test = await testService.create(req.body, req.user);
  ApiResponse.created(res, test);
});

module.exports = { ...base, create };
