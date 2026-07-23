class ApiResponse {
  static send(res, statusCode, data, message = 'Success', meta = undefined) {
    return res.status(statusCode).json({
      success: statusCode < 400,
      message,
      data,
      ...(meta ? { meta } : {}),
    });
  }

  static ok(res, data, message) {
    return ApiResponse.send(res, 200, data, message);
  }

  static created(res, data, message = 'Created') {
    return ApiResponse.send(res, 201, data, message);
  }

  static paginated(res, rows, { page, limit, total }, message) {
    return ApiResponse.send(res, 200, rows, message, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  }
}

module.exports = ApiResponse;
