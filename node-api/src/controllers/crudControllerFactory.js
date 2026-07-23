const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

// Builds standard list/get/create/update/remove handlers bound to a service instance.
// Entity controllers spread this and add/override anything module-specific.
function createCrudController(service) {
  return {
    list: asyncHandler(async (req, res) => {
      const { rows, meta } = await service.list(req.query);
      ApiResponse.paginated(res, rows, meta);
    }),

    getById: asyncHandler(async (req, res) => {
      const item = await service.getById(req.params.id);
      ApiResponse.ok(res, item);
    }),

    create: asyncHandler(async (req, res) => {
      const item = await service.create(req.body);
      ApiResponse.created(res, item);
    }),

    update: asyncHandler(async (req, res) => {
      const item = await service.update(req.params.id, req.body);
      ApiResponse.ok(res, item, 'Updated');
    }),

    remove: asyncHandler(async (req, res) => {
      await service.remove(req.params.id);
      ApiResponse.ok(res, null, 'Deleted');
    }),
  };
}

module.exports = createCrudController;
