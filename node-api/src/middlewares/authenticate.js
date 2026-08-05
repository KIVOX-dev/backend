const { verifyAccessToken } = require('../utils/jwt');
const { mapPythonRole } = require('../config/roleMapping');
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
    // mapPythonRole normalizes any legacy python-service role string (e.g.
    // `college_admin`) still baked into an already-issued token — issueTokens
    // now normalizes on every fresh sign, but this covers sessions signed
    // before that fix, or before a DB row's role gets backfilled, so
    // authorize()'s role check (ROLES.INSTITUTION_ADMIN etc.) always sees
    // the current role vocabulary regardless of what the token literally says.
    req.user = { id: payload.sub, role: mapPythonRole(payload.role), institutionId: payload.institutionId };
    next();
  } catch {
    // Deliberately generic — never echo back jwt.verify's own error message
    // (expired vs malformed vs bad signature), which would hand an attacker
    // a free oracle for probing token validity.
    throw ApiError.unauthorized('Invalid or expired access token');
  }
});
