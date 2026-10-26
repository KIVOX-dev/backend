const crypto = require('crypto');
const net = require('net');
const env = require('../config/env');

// The web app can forward API calls through its own address (/api/v1) so the
// browser's login cookie is first-party. The API then sees the web app's
// server as the caller, so every visitor would share one IP — wrecking the
// per-IP rate limits and the access log. The web app therefore passes the
// visitor's real IP in `x-ts-client-ip`, vouched for by a shared secret in
// `x-ts-proxy-secret`.
//
// The IP is only believed when the secret matches (compared in constant
// time); anything else is ignored and `req.ip` stays what Express worked out
// itself, so nobody can forge their address by sending the header. With no
// FRONTEND_PROXY_SECRET configured this does nothing at all.
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = function frontendProxyIp(req, res, next) {
  const secret = env.frontendProxy.secret;
  if (secret) {
    const presented = req.get('x-ts-proxy-secret');
    const clientIp = req.get('x-ts-client-ip');
    if (presented && clientIp && net.isIP(clientIp) && safeEqual(presented, secret)) {
      // req.ip is a getter on Express's prototype; shadow it on this request.
      Object.defineProperty(req, 'ip', { value: clientIp, configurable: true, enumerable: true });
    }
  }
  next();
};
