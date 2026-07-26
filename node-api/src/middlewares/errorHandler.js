const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const env = require('../config/env');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

// Centralized error handler. MongoDB driver errors are translated into safe, generic
// HTTP responses so raw driver details never leak to API clients.
function errorHandler(err, req, res, next) {
  let { statusCode = 500, message } = err;

  if (err.code === 11000) { // duplicate key (unique index violation)
    statusCode = 409;
    message = 'A record with these details already exists';
  } else if (
    err.name === 'MongoServerSelectionError' ||
    err.name === 'MongoNetworkError' ||
    err.name === 'MongoNotConnectedError'
  ) {
    statusCode = 503;
    message = 'Database is unreachable';
  } else if (!(err instanceof ApiError)) {
    // Some Node errors (e.g. AggregateError from a failed connection attempt) have an
    // empty top-level .message — fall back to a generic one instead of surfacing "".
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
