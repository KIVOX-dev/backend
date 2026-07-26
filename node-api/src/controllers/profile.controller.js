const profileService = require('../services/profile.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const getSchema = asyncHandler(async (req, res) => {
  const schema = profileService.getSchema(req.user);
  ApiResponse.ok(res, schema);
});

const getOwn = asyncHandler(async (req, res) => {
  const result = await profileService.getOwn(req.user);
  ApiResponse.ok(res, result);
});

// req.body already holds the text fields regardless of content-type — either
// express.json() parsed them (plain JSON request) or multer's upload.any()
// middleware did (multipart request, applied on the route — see
// profile.routes.js). req.files (multer, multipart only) holds any uploaded
// files, which get folded in here as their public /uploads/profile/<file>
// path. Ported from python-service's profile.py#_extract_values, which did
// the same content-type-based reconciliation manually.
const saveOwn = asyncHandler(async (req, res) => {
  const values = { ...req.body };
  for (const file of req.files || []) {
    values[file.fieldname] = `/uploads/profile/${file.filename}`;
  }
  const result = await profileService.saveOwn(req.user, values);
  ApiResponse.ok(res, result);
});

module.exports = { getSchema, getOwn, saveOwn };
