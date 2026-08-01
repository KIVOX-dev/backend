class ApiResponse {
  static send(res, statusCode, data, message = 'Success', meta = undefined) {
    return res.status(statusCode).json({
      success: statusCode < 400,
      message,
      data,
      timestamp: new Date().toISOString(),
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
    const totalPages = Math.ceil(total / limit) || 1;
    return ApiResponse.send(res, 200, rows, message, {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    });
  }

  // A handful of live frontend call sites (leaderboard, student-dashboard
  // "insights" — see StudentTracking.tsx, Leaderboard.tsx, hr/page.tsx) read
  // `res.data.data` / `res.data.success` off the *already-unwrapped* axios
  // response (api.ts's interceptor strips one {success,data} envelope layer
  // before their code ever runs). Those call sites were written assuming a
  // second layer that the interceptor already removes, so a bare payload
  // there resolves to undefined instead of the real data. Nesting one extra
  // {success,data} layer here — for these endpoints only — makes the shape
  // line up after that one interceptor unwrap, without touching frontend code.
  static okDoubleWrapped(res, data, message) {
    return ApiResponse.send(res, 200, { success: true, data }, message);
  }
}

module.exports = ApiResponse;
