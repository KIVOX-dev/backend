const chatService = require('../services/chat.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const history = asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const result = await chatService.getHistory(req.user.id, req.params.otherUserId, limit);
  ApiResponse.ok(res, result);
});

module.exports = { history };
