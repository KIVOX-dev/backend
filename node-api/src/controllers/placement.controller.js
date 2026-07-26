const createCrudController = require('./crudControllerFactory');
const placementService = require('../services/placement.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(placementService);

const create = asyncHandler(async (req, res) => {
  const placement = await placementService.create(req.body, req.user);
  ApiResponse.created(res, placement);
});

const listMine = asyncHandler(async (req, res) => {
  const rows = await placementService.listMine(req.user);
  ApiResponse.ok(res, rows);
});

const listDrives = asyncHandler(async (req, res) => {
  const rows = await placementService.listDrives(req.user);
  ApiResponse.ok(res, rows);
});

const listApplicationsForRecruiter = asyncHandler(async (req, res) => {
  const rows = await placementService.listApplicationsForRecruiter(req.user);
  ApiResponse.ok(res, rows);
});

module.exports = { ...base, create, listMine, listDrives, listApplicationsForRecruiter };
