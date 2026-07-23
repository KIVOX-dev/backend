const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const env = require('../config/env');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

// Centralized error handler. Postgres error codes are translated into safe, generic
// HTTP responses so raw driver/SQL details never leak to API clients.
function errorHandler(err, req, res, next) {
  let { statusCode = 500, message } = err;

  if (err.code === '23505') { // unique_violation
    statusCode = 409;
    message = 'A record with these details already exists';
  } else if (err.code === '23503') { // foreign_key_violation
    statusCode = 409;
    message = 'This action references a record that does not exist or is in use';
  } else if (err.code === '22P02') { // invalid_text_representation (bad UUID, etc.)
    statusCode = 400;
    message = 'Invalid identifier or input format';
  } else if (err.code === 'ECONNREFUSED' || err.errors?.some((e) => e.code === 'ECONNREFUSED')) {
    // pg raises a Node AggregateError for connection failures, whose top-level
    // .message is an empty string — surface something actually useful instead.
    statusCode = 503;
    message = 'Database is unreachable';
  } else if (!(err instanceof ApiError)) {
    message = env.isProduction ? 'Internal server error' : message || 'Internal server error';
  }

  if (statusCode >= 500) {
    logger.error(err.message || message, { stack: err.stack, path: req.originalUrl });
  } else {
    logger.warn(err.message, { path: req.originalUrl, statusCode });
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(err.details ? { details: err.details } : {}),
  });
}

module.exports = { notFoundHandler, errorHandler };
