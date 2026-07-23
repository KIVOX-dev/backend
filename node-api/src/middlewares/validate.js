const ApiError = require('../utils/ApiError');

// Validates req[source] (body/query/params) against a Joi schema.
// Rejects unknown fields and strips them from the parsed result before it reaches the controller,
// which is the main SQL-injection/mass-assignment defense at the boundary.
module.exports = function validate(schema, source = 'body') {
  return function (req, res, next) {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      const details = error.details.map((d) => d.message);
      throw ApiError.badRequest('Validation failed', details);
    }
    req[source] = value;
    next();
  };
};
