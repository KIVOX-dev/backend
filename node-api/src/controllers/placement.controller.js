const createCrudController = require('./crudControllerFactory');
const placementService = require('../services/placement.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');

const base = createCrudController(placementService);

const create = asyncHandler(async (req, res) => {
  const placement = await placementService.create(req.body, req.user);
  ApiResponse.created(res, placement);
});

// The frontend consumes both of these as a plain array (no pagination UI —
// see hr/page.tsx), so the response body stays an array; the true total is
// still surfaced via X-Total-Count for any caller that cares whether `rows`
// was truncated (see placement.service.js#listMine/#listDrives).
const listMine = asyncHandler(async (req, res) => {
  const { rows, total } = await placementService.listMine(req.user);
  res.set('X-Total-Count', String(total));
  ApiResponse.ok(res, rows);
});

const listDrives = asyncHandler(async (req, res) => {
  const { rows, total } = await placementService.listDrives(req.user);
  res.set('X-Total-Count', String(total));
  ApiResponse.ok(res, rows);
});

const listApplicationsForRecruiter = asyncHandler(async (req, res) => {
  const rows = await placementService.listApplicationsForRecruiter(req.user);
  ApiResponse.ok(res, rows);
});

const uploadLogo = asyncHandler(async (req, res) => {
  const file = (req.files || [])[0];
  if (!file) throw new ApiError(400, 'No logo uploaded', null, 'BAD_REQUEST');
  ApiResponse.ok(res, await placementService.logoUploaded(file.storageRef), 'Logo uploaded');
});

module.exports = { ...base, uploadLogo, create, listMine, listDrives, listApplicationsForRecruiter };
