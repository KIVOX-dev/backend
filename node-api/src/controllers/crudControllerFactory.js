const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

// Builds standard list/get/create/update/remove handlers bound to a service instance.
// Entity controllers spread this and add/override anything module-specific.
//
// Two list variants, because BaseService.list(queryParams, extraFilters)'s second
// argument means "extra Mongo filter to merge in" for the plain-BaseService services
// (company, hr, activityLog) — passing req.user there would inject {id, role,
// institutionId} straight into their filter and silently corrupt the query. Services
// that instead override list(queryParams, actor) for institution/ownership scoping
// (collegeAdmin, department, faculty, placementRecord, resumeBuilder, student, test)
// need `listWithActor`. This used to be 7 copy-pasted controller-level overrides —
// see PROJECT_AUDIT_REPORT.md P1-3 — centralized here instead.
function createCrudController(service) {
  return {
    list: asyncHandler(async (req, res) => {
      const { rows, meta } = await service.list(req.query);
      ApiResponse.paginated(res, rows, meta);
    }),

    listWithActor: asyncHandler(async (req, res) => {
      const { rows, meta } = await service.list(req.query, req.user);
      ApiResponse.paginated(res, rows, meta);
    }),

    getById: asyncHandler(async (req, res) => {
      const item = await service.getById(req.params.id, req.user);
      ApiResponse.ok(res, item);
    }),

    create: asyncHandler(async (req, res) => {
      const item = await service.create(req.body);
      ApiResponse.created(res, item);
    }),

    update: asyncHandler(async (req, res) => {
      const item = await service.update(req.params.id, req.body, req.user);
      ApiResponse.ok(res, item, 'Updated');
    }),

    remove: asyncHandler(async (req, res) => {
      await service.remove(req.params.id, req.user);
      ApiResponse.ok(res, null, 'Deleted');
    }),
  };
}

module.exports = createCrudController;
