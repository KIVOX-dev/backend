const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

// Correlation ID: accepts an inbound `X-Request-Id` (set by a load balancer,
// or by the frontend/another service calling in) so a request can be traced
// across service boundaries, and generates one when absent (a direct client
// call, or a load balancer that doesn't set one). Echoed back on the
// response so a caller who didn't send one still gets something to quote
// back when reporting an issue. An inbound value is only trusted if it's a
// short, plain token — it's copied into every log line for the request, so
// anything else (newlines, megabytes of text) would be log injection.
const SAFE_REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

// Makes the current request reachable from deep inside services (see
// utils/securityLog.js) without threading `req` through every function
// signature. Holds the req object itself, so req.user — set later by
// authenticate — is visible to anything that reads it afterwards.
const requestContext = new AsyncLocalStorage();

function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  requestContext.run({ req }, next);
}

function currentRequest() {
  return requestContext.getStore()?.req || null;
}

module.exports = requestId;
module.exports.currentRequest = currentRequest;
