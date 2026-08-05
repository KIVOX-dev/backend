// Fallback code per status, used whenever a call site doesn't pass its own
// (more specific) code — see DEFAULT_CODES below and errorHandler.js, which
// applies the same mapping to non-ApiError errors (Mongo/Multer/etc.) so
// every error response carries a stable, machine-readable `code` a frontend
// can branch on, not just a human-readable `message` string that's free to
// change wording without warning.
const DEFAULT_CODES = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
};
const DEFAULT_CODE_FALLBACK = 'INTERNAL_ERROR';

function codeForStatus(statusCode) {
  return DEFAULT_CODES[statusCode] || DEFAULT_CODE_FALLBACK;
}

class ApiError extends Error {
  constructor(statusCode, message, details = null, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.code = code || codeForStatus(statusCode);
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, details, code = 'BAD_REQUEST') {
    return new ApiError(400, message, details, code);
  }
  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    return new ApiError(401, message, null, code);
  }
  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new ApiError(403, message, null, code);
  }
  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new ApiError(404, message, null, code);
  }
  static conflict(message = 'Resource already exists', code = 'CONFLICT') {
    return new ApiError(409, message, null, code);
  }
  static internal(message = 'Internal server error') {
    return new ApiError(500, message, null, 'INTERNAL_ERROR');
  }
  static serviceUnavailable(message = 'Service unavailable') {
    return new ApiError(503, message, null, 'SERVICE_UNAVAILABLE');
  }
}

module.exports = ApiError;
module.exports.codeForStatus = codeForStatus;
