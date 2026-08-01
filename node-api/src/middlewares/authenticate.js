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
  } catch {
    // Deliberately generic — never echo back jwt.verify's own error message
    // (expired vs malformed vs bad signature), which would hand an attacker
    // a free oracle for probing token validity.
    throw ApiError.unauthorized('Invalid or expired access token');
  }
});
