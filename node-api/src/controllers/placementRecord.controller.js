const createCrudController = require('./crudControllerFactory');
const placementRecordService = require('../services/placementRecord.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(placementRecordService);

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await placementRecordService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const create = asyncHandler(async (req, res) => {
  const record = await placementRecordService.create(req.body, req.user);
  ApiResponse.created(res, record);
});

const listForStudent = asyncHandler(async (req, res) => {
  const { rows, meta } = await placementRecordService.listForStudent(req.params.studentId, req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const verify = asyncHandler(async (req, res) => {
  const record = await placementRecordService.verify(req.params.id, req.body.verification_status, req.user);
  ApiResponse.ok(res, record, 'Verification updated');
});

module.exports = { ...base, list, create, listForStudent, verify };
