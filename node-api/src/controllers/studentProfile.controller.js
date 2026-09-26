const studentProfileService = require('../services/studentProfile.service');
const studentSkillService = require('../services/studentSkill.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');

const getOwn = asyncHandler(async (req, res) => {
  const profile = await studentProfileService.getOwn(req.user);
  ApiResponse.ok(res, profile);
});

const getSummary = asyncHandler(async (req, res) => {
  const summary = await studentProfileService.getSummary(req.user);
  ApiResponse.ok(res, summary);
});

const getPracticeTrends = asyncHandler(async (req, res) => {
  const trends = await studentProfileService.getPracticeTrends(req.user);
  ApiResponse.ok(res, trends);
});

const getLeetcodeStats = asyncHandler(async (req, res) => {
  const stats = await studentProfileService.getLeetcodeStats(req.user);
  ApiResponse.ok(res, stats);
});

const getHackerrankStats = asyncHandler(async (req, res) => {
  const stats = await studentProfileService.getHackerrankStats(req.user);
  ApiResponse.ok(res, stats);
});

const uploadAvatar = asyncHandler(async (req, res) => {
  const file = (req.files || [])[0];
  if (!file) throw ApiError.badRequest('No image uploaded');
  const profile = await studentProfileService.uploadAvatar(req.user, file.storageRef);
  ApiResponse.ok(res, profile, 'Profile photo updated');
});

const uploadCoverImage = asyncHandler(async (req, res) => {
  const file = (req.files || [])[0];
  if (!file) throw ApiError.badRequest('No image uploaded');
  const profile = await studentProfileService.uploadCoverImage(req.user, file.storageRef);
  ApiResponse.ok(res, profile, 'Cover image updated');
});

const createOwn = asyncHandler(async (req, res) => {
  const profile = await studentProfileService.createOwn(req.user, req.body);
  ApiResponse.created(res, profile, 'Profile created');
});

const updateOwn = asyncHandler(async (req, res) => {
  const profile = await studentProfileService.updateOwn(req.user, req.body);
  ApiResponse.ok(res, profile, 'Profile updated');
});

const getSkillBadges = asyncHandler(async (req, res) => {
  const badges = await studentSkillService.listBadges(req.user);
  ApiResponse.ok(res, badges);
});

const getCertificates = asyncHandler(async (req, res) => {
  const certificates = await studentSkillService.listCertificates(req.user);
  ApiResponse.ok(res, certificates);
});

module.exports = {
  getOwn,
  createOwn,
  updateOwn,
  getSummary,
  getPracticeTrends,
  getLeetcodeStats,
  getHackerrankStats,
  uploadAvatar,
  uploadCoverImage,
  getSkillBadges,
  getCertificates,
};
