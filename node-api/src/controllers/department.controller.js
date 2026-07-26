const createCrudController = require('./crudControllerFactory');
const departmentService = require('../services/department.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(departmentService);

const listByInstitution = asyncHandler(async (req, res) => {
  const rows = await departmentService.listByInstitution(req.params.id);
  ApiResponse.ok(res, rows);
});

module.exports = { ...base, listByInstitution };
