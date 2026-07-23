const createCrudController = require('./crudControllerFactory');
const userService = require('../services/user.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(userService);

const create = asyncHandler(async (req, res) => {
  const user = await userService.create(req.body, req.user);
  ApiResponse.created(res, user);
});

const update = asyncHandler(async (req, res) => {
  const user = await userService.update(req.params.id, req.body, req.user);
  ApiResponse.ok(res, user, 'Updated');
});

module.exports = { ...base, create, update };
