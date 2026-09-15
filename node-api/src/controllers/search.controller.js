const searchService = require('../services/search.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const { MAX_SEARCH_LENGTH } = require('../utils/regex');

const search = asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) throw ApiError.badRequest('Query parameter "q" is required');
  if (q.length > MAX_SEARCH_LENGTH) throw ApiError.badRequest(`Query must be ${MAX_SEARCH_LENGTH} characters or fewer`);

  const result = await searchService.search(q, req.user);
  ApiResponse.ok(res, result);
});

module.exports = { search };
