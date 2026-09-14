const chatService = require('../services/chat.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');

const VALID_BROADCAST_SCOPES = new Set(['student', 'faculty', 'everyone']);

const history = asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const result = await chatService.getHistory(req.user.id, req.params.otherUserId, limit);
  ApiResponse.ok(res, result);
});

const threads = asyncHandler(async (req, res) => {
  const result = await chatService.getThreads(req.user.id);
  ApiResponse.ok(res, result);
});

const broadcastHistory = asyncHandler(async (req, res) => {
  const { scope } = req.params;
  if (!VALID_BROADCAST_SCOPES.has(scope)) {
    throw ApiError.badRequest(`Invalid broadcast scope: ${scope}`);
  }
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const result = await chatService.getBroadcastHistory(req.user.id, scope, limit);
  ApiResponse.ok(res, result);
});

module.exports = { history, threads, broadcastHistory };
