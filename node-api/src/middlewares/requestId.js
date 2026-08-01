const crypto = require('crypto');

// Correlation ID: accepts an inbound `X-Request-Id` (set by a load balancer,
// or by the frontend/another service calling in) so a request can be traced
// across service boundaries, and generates one when absent (a direct client
// call, or a load balancer that doesn't set one). Echoed back on the
// response so a caller who didn't send one still gets something to quote
// back when reporting an issue.
module.exports = function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = (typeof incoming === 'string' && incoming.trim()) || crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
};
