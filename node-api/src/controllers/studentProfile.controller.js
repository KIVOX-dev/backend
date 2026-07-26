const studentProfileService = require('../services/studentProfile.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const getOwn = asyncHandler(async (req, res) => {
  const profile = await studentProfileService.getOwn(req.user);
  ApiResponse.ok(res, profile);
});

const createOwn = asyncHandler(async (req, res) => {
  const profile = await studentProfileService.createOwn(req.user, req.body);
  ApiResponse.created(res, profile, 'Profile created');
});

const updateOwn = asyncHandler(async (req, res) => {
  const profile = await studentProfileService.updateOwn(req.user, req.body);
  ApiResponse.ok(res, profile, 'Profile updated');
});

module.exports = { getOwn, createOwn, updateOwn };
