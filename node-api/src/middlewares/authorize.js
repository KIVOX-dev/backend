const ApiError = require('../utils/ApiError');

// Role-based access control. Usage: router.post('/', authenticate, authorize('super_admin', 'institution_admin'), handler)
module.exports = function authorize(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user) {
      throw ApiError.unauthorized();
    }
    if (!allowedRoles.includes(req.user.role)) {
      throw ApiError.forbidden(`Role '${req.user.role}' is not permitted to perform this action`);
    }
    next();
  };
};
