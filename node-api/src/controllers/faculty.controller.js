const createCrudController = require('./crudControllerFactory');
const facultyService = require('../services/faculty.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(facultyService);

// Overrides the generic base `list` — facultyService.list() needs `actor`
// for institution scoping, which crudControllerFactory's generic list
// handler doesn't pass.
const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await facultyService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

module.exports = { ...base, list };
