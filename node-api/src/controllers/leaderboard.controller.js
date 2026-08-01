const achievementService = require('../services/achievement.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const get = asyncHandler(async (req, res) => {
  const rows = await achievementService.leaderboard(req.user, req.query.scope);
  ApiResponse.okDoubleWrapped(res, rows);
});

module.exports = { get };
