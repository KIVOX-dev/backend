const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const env = require('../config/env');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

// Centralized error handler. MongoDB driver errors are translated into safe, generic
// HTTP responses so raw driver details never leak to API clients.
function errorHandler(err, req, res, next) {
  let { statusCode = 500, message, code } = err;

  if (err.code === 11000) { // duplicate key (unique index violation)
    statusCode = 409;
    message = 'A record with these details already exists';
    code = 'DUPLICATE_RECORD';
  } else if (err.name === 'MulterError') {
    // multer throws its own error class (not ApiError) for upload-limit
    // violations — LIMIT_FILE_SIZE (upload.js's 5MB cap), too many files,
    // unexpected field name, etc. All of these are the client's fault, not
    // a server fault, so this maps them to 400 instead of falling through
    // to the generic 500 below.
    statusCode = 400;
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File exceeds the maximum upload size';
      code = 'FILE_TOO_LARGE';
    } else {
      message = err.message;
      code = 'UPLOAD_ERROR';
    }
  } else if (
    err.name === 'MongoServerSelectionError' ||
    err.name === 'MongoNetworkError' ||
    err.name === 'MongoNotConnectedError'
  ) {
    statusCode = 503;
    message = 'Database is unreachable';
    code = 'SERVICE_UNAVAILABLE';
  } else if (!(err instanceof ApiError)) {
    // Some Node errors (e.g. AggregateError from a failed connection attempt) have an
    // empty top-level .message — fall back to a generic one instead of surfacing "".
    message = env.isProduction ? 'Internal server error' : message || 'Internal server error';
    code = 'INTERNAL_ERROR';
  }
  // Belt-and-suspenders: any status that reached here without a code (e.g. a
  // future branch above that forgets to set one) still gets a stable
  // fallback derived from the status, rather than `code: undefined`.
  code = code || ApiError.codeForStatus(statusCode);

  if (statusCode >= 500) {
    logger.error(err.message || message, { stack: err.stack, path: req.originalUrl });
  } else {
    logger.warn(err.message, { path: req.originalUrl, statusCode });
  }

  res.status(statusCode).json({
    success: false,
    message,
    // `detail` duplicates `message` for the many frontend call sites still
    // reading FastAPI's HTTPException shape (err.response.data.detail) from
    // the python-service days — without it every one of those falls back to
    // a generic client-side string instead of this response's real message.
    detail: message,
    // Stable, machine-readable — see ApiError.js. `message`/`detail` are for
    // display and are free to reword; `code` is what frontend logic should
    // branch on (e.g. redirecting to login only on 'UNAUTHORIZED', not on
    // every 401-shaped string).
    code,
    timestamp: new Date().toISOString(),
    ...(err.details ? { details: err.details } : {}),
  });
}

module.exports = { notFoundHandler, errorHandler };
