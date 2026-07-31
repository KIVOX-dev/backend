const createCrudController = require('./crudControllerFactory');
const studentService = require('../services/student.service');
const achievementService = require('../services/achievement.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const base = createCrudController(studentService);

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await studentService.list(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const identify = asyncHandler(async (req, res) => {
  const result = await studentService.identify(
    {
      collegeName: req.body.collegeId || req.body.collegeName,
      rollNumber: req.body.rollNo || req.body.studentId,
    },
    { ip: req.ip }
  );
  ApiResponse.ok(res, result, 'Student verified');
});

const listPending = asyncHandler(async (req, res) => {
  const { rows, meta } = await studentService.listPending(req.query, req.user);
  ApiResponse.paginated(res, rows, meta);
});

const dashboard = asyncHandler(async (req, res) => {
  const result = await studentService.dashboard(req.params.id, req.user);
  ApiResponse.ok(res, result);
});

const listTests = asyncHandler(async (req, res) => {
  const rows = await studentService.listTests(req.params.id, req.user);
  ApiResponse.ok(res, rows);
});

const logTest = asyncHandler(async (req, res) => {
  await studentService.logTest(req.params.id, req.body, req.user);
  ApiResponse.ok(res, null, 'Test attempt logged');
});

const testAnalytics = asyncHandler(async (req, res) => {
  const result = await studentService.testAnalytics(req.params.id, req.user);
  ApiResponse.ok(res, result);
});

const listInterviews = asyncHandler(async (req, res) => {
  const rows = await studentService.listInterviews(req.params.id, req.user);
  ApiResponse.ok(res, rows);
});

const logInterview = asyncHandler(async (req, res) => {
  const attempt = await studentService.logInterview(req.params.id, req.body, req.user);
  ApiResponse.created(res, attempt);
});

const batchCreate = asyncHandler(async (req, res) => {
  const result = await studentService.batchCreate(req.body, req.user);
  ApiResponse.created(res, result, `Successfully onboarded ${result.created} students. Status: ${result.status}`);
});

const listAchievements = asyncHandler(async (req, res) => {
  const rows = await achievementService.listForStudent(req.params.id, req.user);
  ApiResponse.ok(res, rows);
});

const evaluateAchievements = asyncHandler(async (req, res) => {
  const rows = await achievementService.evaluate(req.params.id, req.user);
  ApiResponse.ok(res, rows);
});

module.exports = {
  ...base,
  list,
  identify,
  listPending,
  dashboard,
  listTests,
  logTest,
  testAnalytics,
  listInterviews,
  logInterview,
  batchCreate,
  listAchievements,
  evaluateAchievements,
};
