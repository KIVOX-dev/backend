const placementService = require('../services/placement.service');
const driveNotificationService = require('../services/driveNotification.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const schema = require('../validations/drive.validation');

// Express 5's req.query is a read-only getter, so validate/strip it here
// instead of through the validate() middleware (which assigns back to it).
function parse(joiSchema, value) {
  const { error, value: parsed } = joiSchema.validate(value || {}, { abortEarly: false, stripUnknown: true });
  if (error) throw ApiError.badRequest('Validation failed', error.details.map((d) => d.message), 'VALIDATION_ERROR');
  return { eventType: parsed.event_type, roundNumber: parsed.round_number };
}

// placementService.getById does the institution-ownership check, so staff can
// only see/resend notifications for drives in their own institution.
const getNotifications = asyncHandler(async (req, res) => {
  await placementService.getById(req.params.id, req.user);
  const filters = parse(schema.notificationsQuery, req.query);
  const [summary, failedRecipients] = await Promise.all([
    driveNotificationService.getSummary(req.params.id, filters),
    driveNotificationService.listFailed(req.params.id, filters),
  ]);
  ApiResponse.ok(res, { ...summary, failed_recipients: failedRecipients });
});

const resendFailedNotifications = asyncHandler(async (req, res) => {
  await placementService.getById(req.params.id, req.user);
  const filters = parse(schema.resendFailed, req.body);
  const result = await driveNotificationService.resendFailed(req.params.id, filters);
  ApiResponse.ok(res, result, 'Resend queued');
});

const listRounds = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await placementService.listRounds(req.params.id, req.user));
});

const upsertRound = asyncHandler(async (req, res) => {
  const { error, value: roundNumber } = schema.roundNumber.validate(req.params.roundNumber);
  if (error) throw ApiError.badRequest('roundNumber must be an integer from 1 to 20', null, 'VALIDATION_ERROR');
  const round = await placementService.upsertRound(req.params.id, roundNumber, req.body, req.user);
  ApiResponse.ok(res, round, 'Round saved');
});

module.exports = { getNotifications, resendFailedNotifications, listRounds, upsertRound };
