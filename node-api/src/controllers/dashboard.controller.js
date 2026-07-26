const dashboardService = require('../services/dashboard.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const student = asyncHandler(async (req, res) => {
  const result = await dashboardService.studentDashboard(req.params.studentId);
  ApiResponse.ok(res, result);
});

const admin = asyncHandler(async (req, res) => {
  const result = await dashboardService.adminDashboard(req.user);
  ApiResponse.ok(res, result);
});

const superDashboard = asyncHandler(async (req, res) => {
  const result = await dashboardService.superDashboard();
  ApiResponse.ok(res, result);
});

module.exports = { student, admin, super: superDashboard };
