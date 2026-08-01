const createCrudController = require('./crudControllerFactory');
const collegeAdminService = require('../services/collegeAdmin.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(collegeAdminService);

// Overrides the generic base `list` — collegeAdminService.list() needs
// `actor` for institution scoping, which crudControllerFactory's generic
// list handler doesn't pass.
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await collegeAdminService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

module.exports = { ...base, list };
