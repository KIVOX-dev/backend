const userDataService = require('../services/userData.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const getOwn = asyncHandler(async (req, res) => {
  const result = await userDataService.getForUser(req.user);
  ApiResponse.ok(res, result);
});

const saveOwn = asyncHandler(async (req, res) => {
  const result = await userDataService.saveForUser(req.user, req.body.data);
  ApiResponse.ok(res, result, 'Saved');
});

module.exports = { getOwn, saveOwn };
