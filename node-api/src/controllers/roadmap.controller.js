const roadmapService = require('../services/roadmap.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const listRoles = asyncHandler(async (req, res) => {
  const roles = roadmapService.listRoles();
  ApiResponse.ok(res, roles);
});

const getRoadmap = asyncHandler(async (req, res) => {
  const roadmap = await roadmapService.getRoadmap(req.user, req.params.roleId);
  ApiResponse.ok(res, roadmap);
});

const chooseTargetRole = asyncHandler(async (req, res) => {
  const student = await roadmapService.chooseTargetRole(req.user, req.body.roleId);
  ApiResponse.ok(res, student, 'Job role saved');
});

module.exports = { listRoles, getRoadmap, chooseTargetRole };
