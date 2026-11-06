const svc = require('../services/mockSession.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

module.exports = {
  create: asyncHandler(async (req, res) => ApiResponse.created(res, await svc.create(req.body, req.user))),
  list: asyncHandler(async (req, res) => ApiResponse.ok(res, await svc.listOwn(req.user))),
  get: asyncHandler(async (req, res) => ApiResponse.ok(res, await svc.get(req.params.id, req.user))),
  abandon: asyncHandler(async (req, res) => ApiResponse.ok(res, await svc.abandon(req.params.id, req.user))),
  submitRound: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await svc.submitRound(req.params.id, Number(req.params.round), req.body, req.user))
  ),
};
