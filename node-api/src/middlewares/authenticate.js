const { verifyAccessToken } = require('../utils/jwt');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// Verifies the Bearer JWT and attaches { id, role, institutionId } to req.user.
// Does NOT hit the database — the token payload is the source of truth per request,
// which is what lets this scale statelessly across many backend instances.
module.exports = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw ApiError.unauthorized('Missing or malformed Authorization header');
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, institutionId: payload.institutionId };
    next();
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired access token');
  }
});
