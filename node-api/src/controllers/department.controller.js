const createCrudController = require('./crudControllerFactory');
const departmentService = require('../services/department.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(departmentService);

// Overrides the generic base `list` — departmentService.list() needs `actor`
// for institution scoping (see that file), which crudControllerFactory's
// generic list handler doesn't pass.
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await departmentService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const listByInstitution = asyncHandler(async (req, res) => {
  const rows = await departmentService.listByInstitution(req.params.id);
  ApiResponse.ok(res, rows);
});

module.exports = { ...base, list, listByInstitution };
