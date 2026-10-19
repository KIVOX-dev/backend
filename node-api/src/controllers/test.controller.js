const createCrudController = require('./crudControllerFactory');
const testService = require('../services/test.service');
const testNotificationService = require('../services/testNotification.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(testService);

// testService.list needs the actor to gate a student's results to their own
// visible tests (see test.service.js#list).
const list = base.listWithActor;

const create = asyncHandler(async (req, res) => {
  const test = await testService.create(req.body, req.user);
  ApiResponse.created(res, test);
});

const generateQuestions = asyncHandler(async (req, res) => {
  const result = await testService.generateQuestions(req.body);
  ApiResponse.ok(res, result);
});

const overviewStats = asyncHandler(async (req, res) => {
  const stats = await testService.overviewStats(req.user);
  ApiResponse.ok(res, stats);
});

const getResults = asyncHandler(async (req, res) => {
  const rows = await testService.getResults(req.params.id, req.user);
  ApiResponse.ok(res, rows);
});

const collegeResults = asyncHandler(async (req, res) => {
  const rows = await testService.collegeResults(req.user);
  ApiResponse.ok(res, rows);
});

const submitAttempt = asyncHandler(async (req, res) => {
  const attempt = await testService.submitAttempt(req.body, req.user);
  ApiResponse.created(res, attempt);
});

// testService.getById does the institution-ownership check, so an admin can
// only see/resend notifications for tests in their own institution.
const getNotifications = asyncHandler(async (req, res) => {
  await testService.getById(req.params.id, req.user);
  const [summary, failedRecipients] = await Promise.all([
    testNotificationService.getSummary(req.params.id),
    testNotificationService.listFailed(req.params.id),
  ]);
  ApiResponse.ok(res, { ...summary, failed_recipients: failedRecipients });
});

const resendFailedNotifications = asyncHandler(async (req, res) => {
  const test = await testService.getById(req.params.id, req.user);
  const result = await testNotificationService.resendFailed(test);
  ApiResponse.ok(res, result, 'Resend queued');
});

module.exports = {
  ...base, list, create, generateQuestions, overviewStats, getResults, collegeResults, submitAttempt,
  getNotifications, resendFailedNotifications,
};
